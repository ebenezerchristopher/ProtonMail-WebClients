import { CryptoProxy, PublicKeyReference, VERIFICATION_STATUS } from '@proton/crypto';
import { ADDRESS_STATUS, KEY_FLAG } from '@proton/shared/lib/constants';
import { hasBit } from '@proton/shared/lib/helpers/bitset';
import {
    ActiveSignedKeyList,
    Address,
    Api,
    DecryptedKey,
    FetchedSignedKeyList,
    FixMultiplePrimaryKeys,
    KTLocalStorageAPI,
    SignedKeyList,
} from '@proton/shared/lib/interfaces';

import { KT_VE_VERIFICATION_CONTEXT } from '../constants';
import { fetchProof, fetchSignedKeyLists, fetchVerifiedEpoch, uploadVerifiedEpoch } from '../helpers/fetchHelpers';
import { isTimestampOldEnough, isTimestampTooOld, ktSentryReport } from '../helpers/utils';
import { AuditData, KeyWithFlags, PartialKTBlobContent, VerifiedEpoch } from '../interfaces';
import { storeAuditResult } from '../storage/storageHelpers';
import { verifySKLInsideEpochID } from './verifyEpochs';
import { checkKeysInSKL, checkSKLEquality, importKeys, verifySKLSignature } from './verifyKeys';
import { checkLSBlobs } from './verifyLocalStorage';

/**
 * Because the server didn't return any verified epoch, we need
 * to create a new one based on the SKLs we can fetch since we
 * have visibility
 */
export const bootstrapInitialEpoch = async (
    newSKLs: FetchedSignedKeyList[],
    email: string,
    api: Api,
    inputSKL: ActiveSignedKeyList,
    addressVerificationKeys: PublicKeyReference[]
): Promise<AuditData | undefined> => {
    if (newSKLs.length === 0) {
        ktSentryReport('No SKL returned during bootstrap', {
            context: 'bootstrapInitialEpoch',
            email,
        });
        throw new Error('Bootstrapping failed');
    }
    const [oldestSKL] = newSKLs;
    const { MinEpochID } = oldestSKL;
    if (MinEpochID === null) {
        if (!checkSKLEquality(inputSKL, oldestSKL)) {
            ktSentryReport('The oldest new SKL has null MinEpochID but is different from the current SKL', {
                context: 'bootstrapInitialEpoch',
                email,
            });
            throw new Error('Bootstrapping failed');
        }

        const signatureTimestamp = await verifySKLSignature(
            addressVerificationKeys,
            inputSKL.Data,
            inputSKL.Signature,
            'bootstrapInitialEpoch',
            email
        );

        if (!signatureTimestamp) {
            throw new Error('Bootstrapping failed');
        }
        if (isTimestampTooOld(+signatureTimestamp)) {
            ktSentryReport(
                'The current SKL is older than the maximum epoch interval despite having MinEpochID equal to null',
                {
                    context: 'bootstrapInitialEpoch',
                    email,
                }
            );
            throw new Error('Bootstrapping failed');
        }
        // In this case the verified epoch can legitimately be undefined
        return;
    }

    const { certificateTimestamp, Revision } = await verifySKLInsideEpochID(MinEpochID, email, oldestSKL, api);
    if (Revision !== 0 && !isTimestampOldEnough(certificateTimestamp)) {
        ktSentryReport('Bootstrapped epoch is not from around 90 days ago', {
            context: 'bootstrapInitialEpoch',
            certificateTimestamp,
            Revision,
            email,
        });
        throw new Error('Bootstrapping failed');
    }

    const initialEpoch: VerifiedEpoch = {
        EpochID: MinEpochID,
        Revision,
        SKLCreationTime: 0,
    };

    return { initialEpoch, newSKLs };
};

/**
 * Fetch all SKLs that changed since an initial epoch, either the
 * verified epoch or a bootstraped new one
 */
export const getAuditData = async (
    addressID: string,
    email: string,
    apis: Api[],
    inputSKL: ActiveSignedKeyList,
    userVerificationKeys: PublicKeyReference[],
    addressVerificationKeys: PublicKeyReference[]
): Promise<AuditData | undefined> => {
    // silentApi is used to prevent the error notification banner when a verified epoch is not found
    const [api, silentApi] = apis;

    const verifiedEpoch = await fetchVerifiedEpoch(silentApi, addressID);
    if (verifiedEpoch) {
        const { verified, errors } = await CryptoProxy.verifyMessage({
            armoredSignature: verifiedEpoch.Signature,
            verificationKeys: userVerificationKeys,
            textData: verifiedEpoch.Data,
            context: KT_VE_VERIFICATION_CONTEXT,
        });

        if (verified !== VERIFICATION_STATUS.SIGNED_AND_VALID) {
            ktSentryReport('Verified epoch signature verification failed', {
                context: 'getAuditData',
                errors: JSON.stringify(errors),
                email,
            });
        } else {
            const newSKLs = await fetchSignedKeyLists(api, verifiedEpoch.EpochID, email);
            const { MinEpochID } = newSKLs[0] || { MinEpochID: null };

            if (MinEpochID !== null) {
                const {
                    Proof: { Revision },
                } = await fetchProof(MinEpochID, email, api);

                // The verified epoch is too old
                if (Revision > verifiedEpoch.Revision + 1) {
                    return bootstrapInitialEpoch(newSKLs, email, api, inputSKL, addressVerificationKeys);
                }
            }

            return {
                initialEpoch: verifiedEpoch,
                newSKLs,
            };
        }
    }

    const newSKLs = await fetchSignedKeyLists(api, 0, email);
    return bootstrapInitialEpoch(newSKLs, email, api, inputSKL, addressVerificationKeys);
};

const millisecondsToSeconds = (milliseconds: number) => Math.floor(milliseconds / 1000);
const secondsToMilliseconds = (seconds: number) => seconds * 1000;

/**
 * Audit both the user's own SKLs and any SKL the user has used
 * to send messages to
 */
export const auditAddresses = async (
    userID: string,
    apis: Api[],
    addresses: Address[],
    userKeys: DecryptedKey[],
    ktLSAPI: KTLocalStorageAPI,
    fixMultiplePrimaryKeys: FixMultiplePrimaryKeys
) => {
    const [api] = apis;
    const addressesKeys = new Map(
        await Promise.all(
            addresses.map(
                async ({ ID, Keys }): Promise<[string, KeyWithFlags[]]> => [
                    ID,
                    await importKeys(Keys.filter(({ Active }) => Active === 1)),
                ]
            )
        )
    );

    const userPrivateKeys = userKeys.map(({ privateKey }) => privateKey);
    const userVerificationKeys = userKeys.map(({ publicKey }) => publicKey);

    try {
        await checkLSBlobs(userID, userPrivateKeys, ktLSAPI, addressesKeys, apis);
    } catch (error: any) {
        // If something fails from checking local storage, it is
        // reported to sentry. We still want to see if everything
        // else goes through
    }

    // Main loop through own addresses
    for (const address of addresses) {
        const { ID: addressID, Email, SignedKeyList, Status } = address;
        if (Status !== ADDRESS_STATUS.STATUS_ENABLED) {
            // We don't audit disabled addresses. When SAL will be available those
            // won't be present at all
            continue;
        }

        if (!SignedKeyList) {
            ktSentryReport('SignedKeyList not found for internal address', {
                context: 'auditAddresses',
                addressID,
            });
            continue;
        }

        const inputKeys = addressesKeys.get(addressID)!;

        const addressVerificationKeys = inputKeys
            .filter(({ Flags }) => hasBit(Flags, KEY_FLAG.FLAG_NOT_COMPROMISED))
            .map(({ PublicKey }) => PublicKey);

        let initialEpoch: VerifiedEpoch;
        let newSKLs: FetchedSignedKeyList[];
        try {
            const auditData = await getAuditData(
                addressID,
                Email,
                apis,
                SignedKeyList,
                userVerificationKeys,
                addressVerificationKeys
            );

            // In this case self audit for this address has to stop
            // since nothing can be audited yet
            if (!auditData) {
                continue;
            }
            ({ initialEpoch, newSKLs } = auditData);
        } catch (error: any) {
            // Any error has been already reported to sentry, therefore
            // we simply move to the next address
            continue;
        }

        if (!newSKLs.length) {
            if (SignedKeyList.MaxEpochID === null) {
                ktSentryReport('MaxEpochID of input SKL is null, yet no new SKLs are returned', {
                    context: 'auditAddresses',
                    addressID,
                    newSKLs,
                    SignedKeyList,
                });
                continue;
            }

            const { Revision, certificateTimestamp } = await verifySKLInsideEpochID(
                SignedKeyList.MaxEpochID,
                Email,
                SignedKeyList,
                api
            );

            if (Revision !== initialEpoch.Revision) {
                ktSentryReport('Revision of input SKL and initial Revision differ despite claim that no SKL changed', {
                    context: 'auditAddresses',
                    Revision,
                    initialEpochRevision: initialEpoch.Revision,
                    addressID,
                });
                continue;
            }

            if (isTimestampTooOld(certificateTimestamp)) {
                ktSentryReport('Certificate timestamp of a MaxEpochID is too old', {
                    context: 'auditAddresses',
                    certificateTimestamp,
                    addressID,
                });
                continue;
            }

            if (SignedKeyList.MaxEpochID > initialEpoch.EpochID) {
                await uploadVerifiedEpoch(
                    {
                        EpochID: SignedKeyList.MaxEpochID,
                        Revision,
                        SKLCreationTime: initialEpoch.SKLCreationTime,
                    },
                    addressID,
                    userPrivateKeys[0],
                    api
                );
            }

            await fixMultiplePrimaryKeys(address);

            // Self audit has succeeded for this address
            continue;
        }

        const revisionChain: number[] = [];
        let errorFlag = false;
        let lastSKLInKT:
            | {
                  lastRevision: number;
                  lastCertificateTimestamp: number;
                  lastMaxEpochID: number;
                  lastSKLTimestamp: Date | undefined;
              }
            | undefined;
        let previousSKLCreationTime = secondsToMilliseconds(initialEpoch.SKLCreationTime);
        let unverifiableSKLs = false;
        for (let index = 0; index < newSKLs.length; index++) {
            const skl = newSKLs[index];

            // Note that skl might be either an obsolete or an active SKL, however it
            // cannot be the most recent and be obsolete, otherwise this address wouldn't
            // be under audit
            let signatureTimestamp: Date | undefined;
            const isExistent = skl.Data && skl.Signature;
            if (isExistent) {
                // Verify signature
                const timestamp = await verifySKLSignature(
                    addressVerificationKeys,
                    skl.Data!,
                    skl.Signature!,
                    'auditAddresses',
                    Email
                );

                if (timestamp) {
                    if (+timestamp < previousSKLCreationTime) {
                        ktSentryReport('SKL creation time is decreasing', {
                            context: 'auditAddresses',
                            addressID,
                        });
                        errorFlag = true;
                        break;
                    }
                    previousSKLCreationTime = +timestamp;
                    signatureTimestamp = timestamp;
                } else {
                    unverifiableSKLs = true; // show a warning when some SKLs cannot be verified
                }
            }

            if (skl.MaxEpochID === null) {
                if (index !== newSKLs.length - 1) {
                    ktSentryReport('MaxEpochID is null in a SKL which is not the most recent', {
                        context: 'auditAddresses',
                        addressID,
                    });
                    errorFlag = true;
                    break;
                }

                if (!isExistent) {
                    ktSentryReport('Last SKL is obsolete', {
                        context: 'auditAddresses',
                        addressID,
                    });
                    errorFlag = true;
                    break;
                }

                if (!signatureTimestamp) {
                    ktSentryReport('Most recent SKL signature failed verification', {
                        context: 'auditAddresses',
                        addressID,
                    });
                    errorFlag = true;
                    break;
                }

                if (isTimestampTooOld(+signatureTimestamp)) {
                    ktSentryReport('Last SKL is older than max epoch interval and not included', {
                        context: 'auditAddresses',
                        addressID,
                    });
                    errorFlag = true;
                    break;
                }
            } else {
                const { Revision, certificateTimestamp } = await verifySKLInsideEpochID(
                    skl.MaxEpochID,
                    Email,
                    skl,
                    api
                );
                revisionChain.push(Revision);

                lastSKLInKT = {
                    lastRevision: Revision,
                    lastCertificateTimestamp: certificateTimestamp,
                    lastMaxEpochID: skl.MaxEpochID,
                    lastSKLTimestamp: signatureTimestamp,
                };
            }
        }

        if (errorFlag) {
            continue;
        }

        // Check revision chain
        if (
            !!revisionChain.length &&
            revisionChain[0] !== initialEpoch.Revision &&
            revisionChain[0] !== initialEpoch.Revision + 1
        ) {
            ktSentryReport('Revision chain mismatch in the first SKL', {
                context: 'auditAddresses',
                revisionChain,
                initialEpochRevision: initialEpoch.Revision,
                addressID,
            });
            continue;
        }

        if (
            !revisionChain
                .slice(0, revisionChain.length - 1)
                .reduce((acc, current, index) => acc && current + 1 === revisionChain[index + 1], true)
        ) {
            ktSentryReport('Revision chain mismatch', {
                context: 'auditAddresses',
                revisionChain,
                addressID,
            });
            continue;
        }

        const lastSKL = newSKLs[newSKLs.length - 1];
        if (!checkSKLEquality(lastSKL, SignedKeyList)) {
            ktSentryReport('Last SKL in the new SKLs list and input one do not match', {
                context: 'auditAddresses',
                addressID,
            });
            continue;
        }

        const { Data: lastSKLData } = lastSKL;
        if (!lastSKLData) {
            ktSentryReport('Last SKL must have a Data property because it must be active', {
                context: 'auditAddresses',
                addressID,
            });
            continue;
        }

        try {
            await checkKeysInSKL(inputKeys, lastSKLData);
        } catch (error: any) {
            ktSentryReport('Last SKL and current keys do not match', {
                context: 'auditAddresses',
                error,
                addressID,
            });
            continue;
        }

        if (typeof lastSKLInKT !== 'undefined') {
            const { lastRevision, lastCertificateTimestamp, lastMaxEpochID, lastSKLTimestamp } = lastSKLInKT;

            if (isTimestampTooOld(lastCertificateTimestamp)) {
                ktSentryReport('Last certificate timestamp is older than max epoch interval ago', {
                    context: 'auditAddresses',
                    lastCertificateTimestamp,
                    addressID,
                });
                continue;
            }

            if (!lastSKLTimestamp) {
                // The last included SKL is unverifiable, cannot upload verified epoch.
                ktSentryReport('Last SKL timestamp is null', {
                    context: 'auditAddresses',
                    lastCertificateTimestamp,
                    addressID,
                });
                continue; // Will show a warning in the UI
            }

            await uploadVerifiedEpoch(
                {
                    EpochID: lastMaxEpochID,
                    Revision: lastRevision,
                    SKLCreationTime: millisecondsToSeconds(+lastSKLTimestamp),
                },
                addressID,
                userPrivateKeys[0],
                api
            );

            if (unverifiableSKLs) {
                ktSentryReport('Self audit encountered unverifiable SKLs', {
                    context: 'auditAddresses',
                    lastCertificateTimestamp,
                    addressID,
                });
                continue; // Will show a warning in the UI
            }
        }

        await fixMultiplePrimaryKeys(address);
    }

    await storeAuditResult(userID, ktLSAPI);
};

/**
 * Verify that self-audit has run correctly before modifying any key
 */
export const verifyAuditAddressesResult = async (
    address: Address,
    submittedSKL: SignedKeyList,
    selfAuditPromise: Promise<void>,
    addressVerificationKeys: PublicKeyReference[]
): Promise<PartialKTBlobContent> => {
    // In case self audit is running, we must wait for it to be over
    await selfAuditPromise;

    const signatureTimestamp = await verifySKLSignature(
        addressVerificationKeys,
        submittedSKL.Data,
        submittedSKL.Signature,
        'verifyAuditAddressesResult',
        address.Email
    );

    if (!signatureTimestamp) {
        throw new Error('Submitted SKL signature verification failed');
    }

    return {
        PublicKeys: await Promise.all(addressVerificationKeys.map((key) => CryptoProxy.exportPublicKey({ key }))),
        creationTimestamp: signatureTimestamp.getTime(),
        email: address.Email,
        isObsolete: false,
    };
};
