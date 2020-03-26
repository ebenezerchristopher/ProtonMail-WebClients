import React, { MutableRefObject, useEffect, useRef } from 'react';
import { useToggle, useContactEmails, useContactGroups } from 'react-components';

import { MessageExtended } from '../../../models/message';
import AddressesEditor from './AddressesEditor';
import AddressesSummary from './AddressesSummary';
import { ContactEmail } from '../../../models/contact';
import { noop } from 'proton-shared/lib/helpers/function';

interface Props {
    message: MessageExtended;
    disabled: boolean;
    onChange: (message: MessageExtended) => void;
    addressesBlurRef: MutableRefObject<() => void>;
    addressesFocusRef: MutableRefObject<() => void>;
}

const Addresses = ({ message, disabled, onChange, addressesBlurRef, addressesFocusRef }: Props) => {
    const [contacts = [], loadingContacts] = useContactEmails() as [ContactEmail[] | undefined, boolean, Error];
    const [contactGroups = [], loadingContactGroups] = useContactGroups();
    const inputFocusRef = useRef<() => void>(noop);

    // Summary of selected addresses or addresses editor
    const { state: editor, set: setEditor } = useToggle(false);

    // CC and BCC visible in expanded mode
    const { state: expanded, set: setExpanded, toggle: toggleExpanded } = useToggle(false);

    useEffect(() => {
        addressesBlurRef.current = () => setEditor(false);
        addressesFocusRef.current = () => {
            setEditor(true);
            setTimeout(() => inputFocusRef.current());
        };
    }, []);

    if (loadingContacts || loadingContactGroups) {
        return null;
    }

    const handleFocus = () => {
        if (disabled) {
            return false;
        }

        setEditor(true);
        setExpanded(true);
        setTimeout(() => addressesFocusRef.current());
    };

    return editor ? (
        <AddressesEditor
            message={message}
            contacts={contacts}
            contactGroups={contactGroups}
            onChange={onChange}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            inputFocusRef={inputFocusRef}
        />
    ) : (
        <AddressesSummary message={message} contacts={contacts} contactGroups={contactGroups} onFocus={handleFocus} />
    );
};

export default Addresses;
