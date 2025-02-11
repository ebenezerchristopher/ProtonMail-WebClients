import { ORGANIZATION_FLAGS } from '../constants';
import { Organization } from '../interfaces';
import { hasBit } from './bitset';

export const isLoyal = (organization: Partial<Organization> = {}) => {
    return hasBit(organization.Flags, ORGANIZATION_FLAGS.LOYAL);
};

export const hasCovid = (organization: Partial<Organization> = {}) => {
    return hasBit(organization.Flags, ORGANIZATION_FLAGS.COVID);
};

export const hasSMTPSubmission = (organization: Partial<Organization> = {}) => {
    return hasBit(organization.Flags, ORGANIZATION_FLAGS.SMTP_SUBMISSION);
};

export const isDissident = (organization: Partial<Organization> = {}) => {
    return hasBit(organization.Flags, ORGANIZATION_FLAGS.DISSIDENT);
};

export const hasNoCycleScheduled = (organization: Partial<Organization> = {}) => {
    return hasBit(organization.Flags, ORGANIZATION_FLAGS.NO_CYCLE_SCHEDULED);
};

export const isProtoneer = (organization: Partial<Organization> = {}) => {
    return hasBit(organization.Flags, ORGANIZATION_FLAGS.PROTON);
};

export const hasBonuses = (organization: Partial<Organization> = {}) => {
    return !!organization.Flags || !!organization.LoyaltyCounter;
};

export const humanReadableFlags = (organization: Partial<Organization> = {}) => {
    let flags = [];

    if (isLoyal(organization)) {
        flags.push('Loyal');
    }
    if (hasCovid(organization)) {
        flags.push('Covid');
    }
    if (hasSMTPSubmission(organization)) {
        flags.push('SMTP Submission');
    }
    if (isDissident(organization)) {
        flags.push('Dissident');
    }
    if (hasNoCycleScheduled(organization)) {
        flags.push('No Cycle Scheduled');
    }
    if (isProtoneer(organization)) {
        flags.push('Proton');
    }

    return flags.length > 0 ? flags.join(', ') : '-';
};

export const hasFlag = (organization: Partial<Organization> = {}, mask: number) => {
    return hasBit(Number(organization.Flags), Number(mask));
};

export const hasOrganizationSetup = (organization: Partial<Organization> = {}) => {
    return !organization.RequiresKey && !!organization.Name;
};

export const hasOrganizationSetupWithKeys = (organization: Partial<Organization> = {}) => {
    return !!organization.RequiresKey && !!organization.HasKeys;
};
