import { getUnixTime } from 'date-fns';
import {
    CreateCalendarEventSyncData,
    DeleteCalendarEventSyncData,
    syncMultipleEvents,
    UpdateCalendarEventSyncData,
} from 'proton-shared/lib/api/calendars';
import { getAttendeeEmail, modifyAttendeesPartstat, withPmAttendees } from 'proton-shared/lib/calendar/attendees';
import { getIsCalendarDisabled } from 'proton-shared/lib/calendar/calendar';
import {
    CALENDAR_FLAGS,
    ICAL_ATTENDEE_STATUS,
    ICAL_EVENT_STATUS,
    ICAL_METHOD,
} from 'proton-shared/lib/calendar/constants';
import getCreationKeys from 'proton-shared/lib/calendar/integration/getCreationKeys';
import getPaginatedEventsByUID from 'proton-shared/lib/calendar/integration/getPaginatedEventsByUID';
import { findAttendee, getInvitedEventWithAlarms } from 'proton-shared/lib/calendar/integration/invite';
import { getIsRruleEqual } from 'proton-shared/lib/calendar/rruleEqual';
import { createCalendarEvent } from 'proton-shared/lib/calendar/serialize';
import {
    getHasModifiedAttendees,
    getHasModifiedDateTimes,
    getHasModifiedDtstamp,
    propertyToUTCDate,
} from 'proton-shared/lib/calendar/vcalConverter';
import {
    getAttendeeHasPartStat,
    getAttendeePartstat,
    getEventStatus,
    getHasAttendee,
    getHasRecurrenceId,
    getIsAlarmComponent,
} from 'proton-shared/lib/calendar/vcalHelper';
import { withDtstamp } from 'proton-shared/lib/calendar/veventHelper';
import { API_CODES } from 'proton-shared/lib/constants';
import { hasBit } from 'proton-shared/lib/helpers/bitset';
import isTruthy from 'proton-shared/lib/helpers/isTruthy';
import { omit, pick } from 'proton-shared/lib/helpers/object';
import { Address, Api } from 'proton-shared/lib/interfaces';
import {
    Calendar,
    CalendarEvent,
    CalendarEventWithMetadata,
    CalendarWidgetData,
    DecryptedPersonalVeventMapResult,
    SyncMultipleApiResponse,
    VcalAttendeeProperty,
    VcalVeventComponent,
    DecryptedVeventResult,
    SingleEditWidgetData,
} from 'proton-shared/lib/interfaces/calendar';
import { ContactEmail } from 'proton-shared/lib/interfaces/contacts';
import { RequireSome, Unwrap } from 'proton-shared/lib/interfaces/utils';
import { MessageExtended } from '../../models/message';
import { EVENT_INVITATION_ERROR_TYPE, EventInvitationError } from './EventInvitationError';
import {
    EventInvitation,
    getCanCreateSingleEdit,
    getInvitationHasAttendee,
    getIsInvitationOutdated,
    getSequence,
    getSingleEditWidgetData,
    InvitationModel,
    processEventInvitation,
    UPDATE_ACTION,
} from './invite';

const { CANCELLED } = ICAL_EVENT_STATUS;
const { NONE, KEEP_PARTSTAT, RESET_PARTSTAT, CANCEL } = UPDATE_ACTION;

interface GetVeventWithAlarmsArgs {
    calendarEvent: CalendarEventWithMetadata;
    memberID?: string;
    getCalendarEventRaw: (event: CalendarEvent) => Promise<DecryptedVeventResult>;
    getCalendarEventPersonal: (event: CalendarEvent) => Promise<DecryptedPersonalVeventMapResult>;
}
const getVeventWithAlarms = async ({
    calendarEvent,
    memberID,
    getCalendarEventRaw,
    getCalendarEventPersonal,
}: GetVeventWithAlarmsArgs) => {
    const [{ veventComponent: vevent }, eventPersonalMap] = await Promise.all([
        getCalendarEventRaw(calendarEvent),
        getCalendarEventPersonal(calendarEvent),
    ]);
    const personalVevent = memberID ? eventPersonalMap[memberID] : undefined;
    const valarms = personalVevent ? personalVevent.veventComponent : {};
    return {
        ...valarms,
        ...vevent,
    };
};

const getIsNonSoughtEvent = (event: CalendarEventWithMetadata, vevent: VcalVeventComponent) => {
    if (!event.RecurrenceID) {
        return false;
    }
    if (!getHasRecurrenceId(vevent)) {
        return true;
    }
    return getUnixTime(propertyToUTCDate(vevent['recurrence-id'])) !== event.RecurrenceID;
};

export type FetchAllEventsByUID = ({
    uid,
    api,
    recurrenceID,
}: {
    uid: string;
    recurrenceID?: number;
    api: Api;
}) => Promise<{
    event?: CalendarEventWithMetadata;
    otherEvents: CalendarEventWithMetadata[];
    parentEvent?: CalendarEventWithMetadata;
    otherParentEvents?: CalendarEventWithMetadata[];
}>;

const fetchAllEventsByUID: FetchAllEventsByUID = async ({ uid, api, recurrenceID }) => {
    const promises: Promise<CalendarEventWithMetadata[]>[] = [getPaginatedEventsByUID({ api, uid })];
    if (recurrenceID) {
        promises.unshift(getPaginatedEventsByUID({ api, uid, recurrenceID }));
    }
    const [[event, ...otherEvents] = [], [parentEvent, ...otherParentEvents] = []] = await Promise.all(promises);
    if (parentEvent) {
        // If recurrenceID is passed, but not single edit is found, return the parent
        return event
            ? { event, otherEvents, parentEvent, otherParentEvents }
            : { event: parentEvent, otherEvents: otherParentEvents };
    }
    return { event, otherEvents };
};

type FetchEventInvitation = (args: {
    veventComponent: VcalVeventComponent;
    api: Api;
    getCalendarInfo: (
        ID: string
    ) => Promise<Omit<CalendarWidgetData, 'calendar' | 'isCalendarDisabled' | 'calendarNeedsUserAction'>>;
    getCalendarEventRaw: (event: CalendarEvent) => Promise<DecryptedVeventResult>;
    getCalendarEventPersonal: (event: CalendarEvent) => Promise<DecryptedPersonalVeventMapResult>;
    calendars: Calendar[];
    defaultCalendar?: Calendar;
    message: MessageExtended;
    contactEmails: ContactEmail[];
    ownAddresses: Address[];
    isFreeUser: boolean;
}) => Promise<{
    invitation?: RequireSome<EventInvitation, 'calendarEvent'>;
    parentInvitation?: RequireSome<EventInvitation, 'calendarEvent'>;
    calendarData?: CalendarWidgetData;
    singleEditData?: SingleEditWidgetData;
    hasDecryptionError?: boolean;
}>;
export const fetchEventInvitation: FetchEventInvitation = async ({
    veventComponent,
    api,
    getCalendarInfo,
    getCalendarEventRaw,
    getCalendarEventPersonal,
    calendars,
    defaultCalendar,
    message,
    contactEmails,
    ownAddresses,
    isFreeUser,
}) => {
    if (isFreeUser) {
        // The API may return calendar data for downgraded free users,
        // but at the moment those users are not entitled to have a calendar
        return {};
    }
    const recurrenceID = veventComponent['recurrence-id'];
    const timestamp = recurrenceID ? getUnixTime(propertyToUTCDate(recurrenceID)) : undefined;
    const allEventsWithUID = await fetchAllEventsByUID({
        uid: veventComponent.uid.value,
        api,
        recurrenceID: timestamp,
    });
    const { event: calendarEvent, parentEvent: calendarParentEvent } = allEventsWithUID;
    const calendar =
        calendars.find(({ ID }) => ID === (calendarEvent || calendarParentEvent)?.CalendarID) || defaultCalendar;
    if (!calendar) {
        return {};
    }
    const calendarData = {
        calendar,
        isCalendarDisabled: getIsCalendarDisabled(calendar),
        calendarNeedsUserAction:
            hasBit(calendar.Flags, CALENDAR_FLAGS.RESET_NEEDED) ||
            hasBit(calendar.Flags, CALENDAR_FLAGS.UPDATE_PASSPHRASE),
        ...(await getCalendarInfo(calendar.ID)),
    };
    // if we retrieved a single edit when not looking for one, or looking for another one, do not return it
    if (!calendarEvent || getIsNonSoughtEvent(calendarEvent, veventComponent)) {
        return { calendarData };
    }
    const singleEditData = getSingleEditWidgetData(allEventsWithUID);
    try {
        const vevents = await Promise.all(
            [calendarEvent, calendarParentEvent].filter(isTruthy).map((event) =>
                getVeventWithAlarms({
                    calendarEvent: event,
                    memberID: calendarData.memberID,
                    getCalendarEventRaw,
                    getCalendarEventPersonal,
                })
            )
        );
        const [vevent, parentVevent] = vevents;
        const result: Unwrap<ReturnType<FetchEventInvitation>> = { calendarData, singleEditData };
        const { invitation } = processEventInvitation({ vevent }, message, contactEmails, ownAddresses);
        result.invitation = { ...invitation, calendarEvent };
        if (parentVevent && calendarParentEvent) {
            const { invitation: parentInvitation } = processEventInvitation(
                { vevent: parentVevent },
                message,
                contactEmails,
                ownAddresses
            );
            result.parentInvitation = { ...parentInvitation, calendarEvent: calendarParentEvent };
        }
        return result;
    } catch (e) {
        // We need to detect if the error is due to a failed decryption of the event.
        // We don't have a great way of doing this as the error comes from openpgp
        return { calendarData, hasDecryptionError: e.message.includes('decrypt') };
    }
};

interface UpdateEventArgs {
    calendarEvent: CalendarEvent;
    vevent: VcalVeventComponent;
    api: Api;
    calendarData: Required<CalendarWidgetData>;
    createSingleEdit?: boolean;
    deleteIds?: string[];
    overwrite: boolean;
}
const updateEventApi = async ({
    calendarEvent,
    vevent,
    api,
    calendarData,
    createSingleEdit = false,
    overwrite,
    deleteIds = [],
}: UpdateEventArgs) => {
    const {
        calendar: { ID: calendarID },
        memberID,
        addressKeys,
        calendarKeys,
    } = calendarData;
    const veventWithPmAttendees = await withPmAttendees(vevent, api);
    const creationKeys = await getCreationKeys({
        Event: createSingleEdit ? undefined : calendarEvent,
        addressKeys,
        newCalendarKeys: calendarKeys,
    });
    const data = await createCalendarEvent({
        eventComponent: veventWithPmAttendees,
        isSwitchCalendar: false,
        ...creationKeys,
    });
    const deleteEvents = deleteIds.map((id) => ({ ID: id }));
    const Events: (
        | CreateCalendarEventSyncData
        | UpdateCalendarEventSyncData
        | DeleteCalendarEventSyncData
    )[] = createSingleEdit
        ? [{ Event: { Permissions: 3, IsOrganizer: 0, ...data }, Overwrite: overwrite ? 1 : 0 }]
        : [...deleteEvents, { Event: { Permissions: 3, ...data }, ID: calendarEvent.ID }];
    const {
        Responses: [
            {
                Response: { Code, Event },
            },
        ],
    } = await api<SyncMultipleApiResponse>({
        ...syncMultipleEvents(calendarID, { MemberID: memberID, Events }),
        silence: true,
    });
    if (Code !== API_CODES.SINGLE_SUCCESS || !Event) {
        throw new Error('Update unsuccessful');
    }
    return Event;
};

interface UpdateEventInvitationArgs
    extends Omit<
        RequireSome<InvitationModel, 'invitationIcs' | 'invitationApi'>,
        'timeStatus' | 'isFreeUser' | 'canCreateCalendar' | 'hasNoCalendars'
    > {
    isOrganizerMode: boolean;
    isAddressDisabled: boolean;
    isOutdated?: boolean;
    updateAction?: UPDATE_ACTION;
    hideSummary?: boolean;
    invitationIcs: RequireSome<EventInvitation, 'method'>;
    invitationApi: RequireSome<EventInvitation, 'calendarEvent' | 'attendee'>;
    parentInvitationApi?: RequireSome<EventInvitation, 'calendarEvent'>;
    calendarData: Required<CalendarWidgetData>;
    singleEditData?: SingleEditWidgetData;
    api: Api;
    message: MessageExtended;
    contactEmails: ContactEmail[];
    ownAddresses: Address[];
    overwrite: boolean;
}
export const updateEventInvitation = async ({
    isOrganizerMode,
    calendarData,
    singleEditData,
    isAddressDisabled,
    invitationIcs,
    invitationApi,
    parentInvitationApi,
    api,
    message,
    contactEmails,
    ownAddresses,
    overwrite,
}: UpdateEventInvitationArgs): Promise<{
    action: UPDATE_ACTION;
    invitation?: RequireSome<EventInvitation, 'calendarEvent' | 'attendee'>;
}> => {
    const { method, vevent: veventIcs, attendee: attendeeIcs } = invitationIcs;
    const { calendarEvent, vevent: veventApi, attendee: attendeeApi } = invitationApi;
    const vcalAttendeeIcs = attendeeIcs?.vcalComponent;
    const vcalAttendeeApi = attendeeApi?.vcalComponent;
    const recurrenceIdIcs = veventIcs['recurrence-id'];

    if (isOrganizerMode) {
        // TODO
        if (method === ICAL_METHOD.REPLY) {
            if (!veventApi) {
                if (!recurrenceIdIcs) {
                    return { action: NONE };
                }
                // TODO: create single edit
            }
            if (!vcalAttendeeIcs) {
                throw new EventInvitationError(EVENT_INVITATION_ERROR_TYPE.UPDATING_ERROR);
            }
            if (!getAttendeeHasPartStat(vcalAttendeeIcs) || !getAttendeeHasPartStat(vcalAttendeeApi)) {
                throw new Error('Participation status of attendees required');
            }
            const partStatIcs = vcalAttendeeIcs.parameters.partstat;
            const partStatApi = vcalAttendeeApi.parameters.partstat;
            if (partStatApi !== partStatIcs) {
                // TODO: update eventApi with partstatIcs
            }
        }
    }
    // attendee mode
    if (
        isAddressDisabled ||
        calendarData.isCalendarDisabled ||
        getIsInvitationOutdated(veventIcs, veventApi) ||
        !attendeeIcs ||
        !attendeeApi
    ) {
        // do not update
        return { action: NONE };
    }

    if (method === ICAL_METHOD.REQUEST) {
        if (!veventApi) {
            // TODO: check for SharedEventID and create new event accordingly
            return { action: NONE };
        }
        const hasUpdatedDtstamp = getHasModifiedDtstamp(veventIcs, veventApi);
        const sequenceDiff = getSequence(veventIcs) - getSequence(veventApi);
        const hasUpdatedDateTimes = getHasModifiedDateTimes(veventIcs, veventApi);
        const hasUpdatedTitle = veventIcs.summary?.value !== veventApi.summary?.value;
        const hasUpdatedDescription = veventIcs.description?.value !== veventApi.description?.value;
        const hasUpdatedLocation = veventIcs.location?.value !== veventApi.location?.value;
        const hasUpdatedRrule = !getIsRruleEqual(veventIcs.rrule, veventApi.rrule);
        const hasUpdatedAttendees = getHasModifiedAttendees({ veventIcs, veventApi, attendeeIcs, attendeeApi });
        const isReinvited = getEventStatus(veventApi) === CANCELLED;
        const hasBreakingChange = hasUpdatedDtstamp ? sequenceDiff > 0 : false;
        const hasNonBreakingChange = hasUpdatedDtstamp
            ? hasUpdatedDateTimes ||
              hasUpdatedTitle ||
              hasUpdatedDescription ||
              hasUpdatedLocation ||
              hasUpdatedRrule ||
              hasUpdatedAttendees
            : false;
        const action = hasBreakingChange || isReinvited ? RESET_PARTSTAT : hasNonBreakingChange ? KEEP_PARTSTAT : NONE;
        if ([KEEP_PARTSTAT, RESET_PARTSTAT].includes(action)) {
            // update the api event by the ics one with the appropriate answer
            const createSingleEdit = getHasRecurrenceId(veventIcs) && !getHasRecurrenceId(veventApi);
            const canCreateSingleEdit = createSingleEdit ? getCanCreateSingleEdit(veventIcs, veventApi) : undefined;
            if (createSingleEdit && !canCreateSingleEdit) {
                // The parent has been updated. Nothing to do then
                return { action: NONE };
            }
            try {
                if (!vcalAttendeeIcs) {
                    throw new Error('Missing attendee parameters');
                }
                const veventIcsWithApiAlarms: VcalVeventComponent = {
                    ...veventIcs,
                    components: [
                        ...(veventIcs.components || []),
                        ...(veventApi.components || []).filter((component) => getIsAlarmComponent(component)),
                    ],
                };
                const updatedVevent = withDtstamp(
                    getInvitedEventWithAlarms(
                        veventIcsWithApiAlarms,
                        getAttendeePartstat(vcalAttendeeIcs),
                        calendarData.calendarSettings,
                        getAttendeePartstat(vcalAttendeeApi)
                    )
                );
                // we are updating a recurring event with previous modifications. We must delete those
                const updatedCalendarEvent = await updateEventApi({
                    calendarEvent,
                    vevent: updatedVevent,
                    calendarData,
                    createSingleEdit,
                    deleteIds: singleEditData?.ids,
                    api,
                    overwrite,
                });
                const { invitation: updatedInvitation } = processEventInvitation(
                    { vevent: updatedVevent, calendarEvent: updatedCalendarEvent },
                    message,
                    contactEmails,
                    ownAddresses
                );
                if (!getInvitationHasAttendee(updatedInvitation)) {
                    throw new Error('Missing attendee after update');
                }
                return { action, invitation: { ...updatedInvitation, calendarEvent: updatedCalendarEvent } };
            } catch (error) {
                throw new EventInvitationError(EVENT_INVITATION_ERROR_TYPE.UPDATING_ERROR);
            }
        }
        return { action };
    }
    if (method === ICAL_METHOD.CANCEL) {
        let cancel = false;
        if (veventApi) {
            if (getEventStatus(veventApi) === CANCELLED) {
                return { action: NONE };
            }
            cancel = true;
        } else {
            const parentExdates = parentInvitationApi?.vevent.exdate;
            if (!recurrenceIdIcs || !parentExdates) {
                return { action: NONE };
            }
            const isCancelled = parentExdates.find((exdate) => {
                return +propertyToUTCDate(exdate) === +propertyToUTCDate(recurrenceIdIcs);
            });
            cancel = !isCancelled;
        }
        // cancel API event if needed
        if (cancel) {
            const createSingleEdit = getHasRecurrenceId(veventIcs) && !getHasRecurrenceId(veventApi);
            const canCreateSingleEdit = createSingleEdit ? getCanCreateSingleEdit(veventIcs, veventApi) : undefined;
            if (createSingleEdit && !canCreateSingleEdit) {
                // The parent has been updated. Nothing to do then
                return { action: NONE };
            }
            try {
                const updatedVevent = createSingleEdit
                    ? {
                          // TODO properly
                          ...omit(veventIcs, ['rrule']),
                          status: { value: CANCELLED },
                      }
                    : {
                          ...veventApi,
                          dtstamp: veventIcs.dtstamp,
                          status: { value: CANCELLED },
                      };
                await updateEventApi({
                    calendarEvent,
                    vevent: getInvitedEventWithAlarms(updatedVevent, ICAL_ATTENDEE_STATUS.DECLINED),
                    calendarData,
                    createSingleEdit,
                    api,
                    overwrite,
                });
                const { invitation: updatedInvitation } = processEventInvitation(
                    { vevent: updatedVevent },
                    message,
                    contactEmails,
                    ownAddresses
                );
                if (!getInvitationHasAttendee(updatedInvitation)) {
                    throw new Error('Missing attendee after update');
                }
                return { action: CANCEL, invitation: { ...updatedInvitation, calendarEvent } };
            } catch (error) {
                throw new EventInvitationError(EVENT_INVITATION_ERROR_TYPE.CANCELLATION_ERROR);
            }
        }
        return { action: RESET_PARTSTAT };
    }
    return { action: NONE };
};

export const createCalendarEventFromInvitation = async ({
    vevent,
    vcalAttendee,
    partstat,
    api,
    calendarData,
    overwrite,
}: {
    vevent: VcalVeventComponent;
    vcalAttendee: VcalAttendeeProperty;
    partstat: ICAL_ATTENDEE_STATUS;
    calendarData?: CalendarWidgetData;
    api: Api;
    overwrite: boolean;
}) => {
    const { calendar, memberID, addressKeys, calendarKeys, calendarSettings } = calendarData || {};
    if (!calendar || !memberID || !addressKeys || !calendarKeys || !calendarSettings) {
        throw new Error('Missing data for creating calendar event from invitation');
    }
    // save attendee answer
    const vcalAttendeeToSave = {
        ...vcalAttendee,
        parameters: {
            ...vcalAttendee.parameters,
            partstat,
        },
    };
    // add alarms to event if necessary
    const veventToSave = getInvitedEventWithAlarms(vevent, partstat, calendarSettings);
    const { index: attendeeIndex } = findAttendee(getAttendeeEmail(vcalAttendee), veventToSave.attendee);
    if (!veventToSave.attendee || attendeeIndex === undefined || attendeeIndex === -1) {
        throw new Error('Missing data for creating calendar event from invitation');
    }
    veventToSave.attendee[attendeeIndex] = vcalAttendeeToSave;
    const veventToSaveWithPmAttendees = await withPmAttendees(veventToSave, api);
    // create calendar event
    const data = await createCalendarEvent({
        eventComponent: veventToSaveWithPmAttendees,
        isSwitchCalendar: false,
        ...(await getCreationKeys({ addressKeys, newCalendarKeys: calendarKeys })),
    });
    const Events: CreateCalendarEventSyncData[] = [
        { Overwrite: overwrite ? 1 : 0, Event: { Permissions: 3, IsOrganizer: 0, ...data } },
    ];
    const {
        Responses: [
            {
                Response: { Code, Event },
            },
        ],
    } = await api<SyncMultipleApiResponse>({
        ...syncMultipleEvents(calendar.ID, { MemberID: memberID, Events }),
        silence: true,
    });
    if (Code !== API_CODES.SINGLE_SUCCESS || !Event) {
        throw new Error('Creating calendar event from invitation failed');
    }
    return {
        savedEvent: Event,
        savedVevent: veventToSaveWithPmAttendees,
        savedVcalAttendee: vcalAttendeeToSave,
    };
};

export const updatePartstatFromInvitation = async ({
    veventApi,
    calendarEvent,
    veventIcs,
    vcalAttendee,
    partstat,
    oldPartstat,
    api,
    calendarData,
}: {
    veventApi: VcalVeventComponent;
    calendarEvent: CalendarEvent;
    veventIcs?: VcalVeventComponent;
    vcalAttendee: VcalAttendeeProperty;
    partstat: ICAL_ATTENDEE_STATUS;
    oldPartstat?: ICAL_ATTENDEE_STATUS;
    calendarData?: CalendarWidgetData;
    api: Api;
    overwrite: boolean;
}) => {
    const { calendar, memberID, addressKeys, calendarKeys, calendarSettings } = calendarData || {};
    if (
        !getHasAttendee(veventApi) ||
        (veventIcs && !getHasAttendee(veventIcs)) ||
        !calendar ||
        !memberID ||
        !addressKeys ||
        !calendarKeys ||
        !calendarSettings
    ) {
        throw new Error('Missing data for updating calendar event from invitation');
    }
    const emailAddress = getAttendeeEmail(vcalAttendee);
    const veventToUpdate = veventIcs
        ? { ...veventIcs, ...pick(veventApi, ['components', 'exdate']) }
        : { ...veventApi };
    const updatedVevent = {
        ...veventToUpdate,
        attendee: modifyAttendeesPartstat(veventToUpdate.attendee, { [emailAddress]: partstat }),
    };
    // add alarms to event if necessary
    const veventToSave = getInvitedEventWithAlarms(updatedVevent, partstat, calendarSettings, oldPartstat);
    const veventWithPmAttendees = await withPmAttendees(veventToSave, api);
    const vcalAttendeeToSave = {
        ...vcalAttendee,
        parameters: { ...vcalAttendee.parameters, partstat },
    };
    // update calendar event
    const creationKeys = await getCreationKeys({
        Event: calendarEvent,
        addressKeys,
        newCalendarKeys: calendarKeys,
    });
    const data = await createCalendarEvent({
        eventComponent: veventWithPmAttendees,
        isSwitchCalendar: false,
        ...creationKeys,
    });
    const Events: UpdateCalendarEventSyncData[] = [{ Event: { Permissions: 3, ...data }, ID: calendarEvent.ID }];
    const {
        Responses: [
            {
                Response: { Code, Event },
            },
        ],
    } = await api<SyncMultipleApiResponse>({
        ...syncMultipleEvents(calendar.ID, { MemberID: memberID, Events }),
        silence: true,
    });
    if (Code !== API_CODES.SINGLE_SUCCESS || !Event) {
        throw new Error('Updating calendar event from invitation failed');
    }
    return {
        savedEvent: Event,
        savedVevent: veventToSave,
        savedVcalAttendee: vcalAttendeeToSave,
    };
};
