import { AddressKeyPayload, AddressKeyPayloadV2, SignedKeyList } from '../interfaces';

interface GetPublicKeysParams {
    Email: string;
    Fingerprint?: string;
}

export const getPublicKeys = (params: GetPublicKeysParams) => ({
    url: 'core/v4/keys',
    method: 'get',
    params,
});

export const getKeySalts = () => ({
    url: 'core/v4/keys/salts',
    method: 'get',
});

interface CreateUserKeyPayload {
    Primary: number;
    PrivateKey: string;
}

export const createUserKeyRoute = (data: CreateUserKeyPayload) => ({
    url: 'core/v4/keys/user',
    method: 'post',
    data,
});

interface AddressKeyToken {
    AddressKeyID: string;
    KeyPacket: string;
    Signature: string;
}
interface AddressTokensPayload {
    AddressKeyTokens: AddressKeyToken[];
}
export const replaceAddressTokens = (data: AddressTokensPayload) => ({
    url: 'core/v4/keys/tokens',
    method: 'put',
    data,
});

interface CreateAddressKeyPayload {
    AddressID: string;
    Primary: number;
    PrivateKey: string;
    SignedKeyList: SignedKeyList;
}

export const createAddressKeyRoute = (data: CreateAddressKeyPayload) => ({
    url: 'core/v4/keys',
    method: 'post',
    data,
});

interface CreateAddressKeyPayloadV2 extends CreateAddressKeyPayload {
    Token: string;
    Signature: string;
}

export const createAddressKeyRouteV2 = (data: CreateAddressKeyPayloadV2) => ({
    url: 'core/v4/keys/address',
    method: 'post',
    data,
});

interface SetupKeysPayload {
    PrimaryKey: string;
    KeySalt: string;
    AddressKeys: (AddressKeyPayload | AddressKeyPayloadV2)[];
}

export const setupKeys = (data: SetupKeysPayload) => ({
    url: 'core/v4/keys/setup',
    method: 'post',
    data,
});

interface ActivateKeyPayload {
    ID: string;
    PrivateKey: string;
    SignedKeyList: SignedKeyList;
}

export const activateKeyRoute = ({ ID, ...data }: ActivateKeyPayload) => ({
    url: `core/v4/keys/${ID}/activate`,
    method: 'put',
    data,
});

interface ActivateKeyPayloadV2 extends ActivateKeyPayload {
    Signature: string;
    Token: string;
}

export const activateKeyRouteV2 = ({ ID, ...data }: ActivateKeyPayloadV2) => ({
    url: `core/v4/keys/address/${ID}`,
    method: 'put',
    data,
});

export const reactiveLegacyAddressKeyRouteV2 = ({ ID, ...data }: ActivateKeyPayloadV2) => ({
    url: `core/v4/keys/address/${ID}`,
    method: 'put',
    data,
});

interface ReactivateKeyPayload {
    ID: string;
    PrivateKey: string;
    SignedKeyList?: SignedKeyList;
}

export const reactivateKeyRoute = ({ ID, PrivateKey, SignedKeyList }: ReactivateKeyPayload) => ({
    url: `core/v4/keys/${ID}`,
    method: 'put',
    data: {
        PrivateKey,
        SignedKeyList,
    },
});

interface ReactivateUserKeyPayloadV2 {
    ID: string;
    PrivateKey: string;
    AddressKeyFingerprints: string[];
    SignedKeyLists: {
        [key: string]: SignedKeyList;
    };
}

export const reactivateUserKeyRouteV2 = ({ ID, ...data }: ReactivateUserKeyPayloadV2) => ({
    url: `core/v4/keys/user/${ID}`,
    method: 'put',
    data,
});

interface SetKeyPrimaryPayload {
    ID: string;
    SignedKeyList: SignedKeyList;
}

export const setKeyPrimaryRoute = ({ ID, ...data }: SetKeyPrimaryPayload) => ({
    url: `core/v4/keys/${ID}/primary`,
    method: 'put',
    data,
});

interface SetKeyFlagsPayload {
    ID: string;
    Flags: number;
    SignedKeyList: SignedKeyList;
}

export const setKeyFlagsRoute = ({ ID, ...data }: SetKeyFlagsPayload) => ({
    url: `core/v4/keys/${ID}/flags`,
    method: 'put',
    data,
});

interface RemoveKeyPayload {
    ID: string;
    SignedKeyList: SignedKeyList;
}

export const removeKeyRoute = ({ ID, ...data }: RemoveKeyPayload) => ({
    url: `core/v4/keys/${ID}/delete`,
    method: 'put',
    data,
});

export interface UpdatePrivateKeyPayload {
    KeySalt: string;
    Keys: { ID: string; PrivateKey: string }[];
    OrganizationKey?: string;
}

export interface UpdatePrivateKeyPayloadV2 {
    KeySalt: string;
    UserKeys: { ID: string; PrivateKey: string }[];
    OrganizationKey?: string;
}

export const updatePrivateKeyRoute = (data: UpdatePrivateKeyPayload | UpdatePrivateKeyPayloadV2) => ({
    url: 'core/v4/keys/private',
    method: 'put',
    data,
});

export interface ResetKeysPayload {
    Username: string;
    Token: string;
    KeySalt: string;
}

export interface ResetKeysPayloadWithKeys extends ResetKeysPayload {
    PrimaryKey: string;
    AddressKeys: AddressKeyPayload[];
}

export interface ResetKeysPayloadV2 extends ResetKeysPayload {
    PrimaryKey: string;
    AddressKeys: AddressKeyPayloadV2[];
}

export const resetKeysRoute = (data: ResetKeysPayloadWithKeys | ResetKeysPayloadV2 | ResetKeysPayload) => ({
    url: 'core/v4/keys/reset',
    method: 'post',
    data,
});

interface UpgradeKeyPayload {
    ID: string;
    PrivateKey: string;
}

interface UpgradeKeysPayload {
    KeySalt: string;
    Keys: UpgradeKeyPayload[];
    OrganizationKey?: string;
}

export interface UpgradeAddressKeyPayload {
    ID: string;
    PrivateKey: string;
    Token: string;
    Signature: string;
}

interface UpgradeKeysPayloadV2 {
    KeySalt: string;
    UserKeys: UpgradeKeyPayload[];
    AddressKeys: UpgradeAddressKeyPayload[];
    OrganizationKey?: string;
    SignedKeyLists: {
        [key: string]: SignedKeyList;
    };
}

export const upgradeKeysRoute = (data: UpgradeKeysPayload | UpgradeKeysPayloadV2) => ({
    url: 'core/v4/keys/private/upgrade',
    method: 'post',
    data,
});

export interface MigrateAddressKeyPayload {
    ID: string;
    Token: string;
    Signature: string;
    PrivateKey: string;
}

export interface MigrateAddressKeysPayload {
    AddressKeys: MigrateAddressKeyPayload[];
    SignedKeyLists: { [key: string]: SignedKeyList };
}

export const migrateAddressKeysRoute = (data: MigrateAddressKeysPayload) => ({
    url: 'core/v4/keys/migrate',
    method: 'post',
    data,
});

export interface GetSignedKeyListsParams {
    AfterEpochID?: number;
    Email: string;
}

export const getSignedKeyListsRoute = (params: GetSignedKeyListsParams) => ({
    url: 'core/v4/keys/signedkeylists',
    method: 'get',
    params,
});

export interface GetSignedKeyListParams {
    EpochID: number;
    Email: string;
}

export const getSignedKeyListRoute = (params: GetSignedKeyListParams) => ({
    url: 'keys/signedkeylist',
    method: 'get',
    params,
});

export interface UpdateSignedKeyListParams {
    AddressID: string;
}

export interface UpdateSignedKeyListPayload {
    SignedKeyList: SignedKeyList;
}

export const updateSignedKeyListRoute = (params: UpdateSignedKeyListParams, data: UpdateSignedKeyListPayload) => ({
    url: 'core/v4/keys/signedkeylists',
    method: 'post',
    params,
    data,
});
