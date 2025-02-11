import { ChangeEvent, useEffect, useMemo, useRef } from 'react';

import { c } from 'ttag';

import { Input } from '@proton/atoms';
import { SelectChangeEvent } from '@proton/components/components/selectTwo/select';
import { requestAnimationFrameRateLimiter } from '@proton/components/hooks/useElementRect';
import clsx from '@proton/utils/clsx';

import { Icon, Label, Option, SelectTwo } from '../../components';
import { DEFAULT_SEPARATOR, getFullList } from '../../helpers/countries';
import { useElementRect } from '../../hooks';
import { CardModel } from '../../payments/core/interface';
import { formatCreditCardNumber, isValidNumber } from './CardNumberInput';
import { handleExpOnChange } from './ExpInput';
import { CardFieldStatus } from './useCard';

import './CreditCardNewDesign.scss';

const WarningIcon = ({ className }: { className?: string }) => {
    return (
        <Icon
            name="exclamation-circle-filled"
            className={clsx('flex-item-noshrink color-danger', className)}
            size={18}
        />
    );
};

interface Props {
    onChange: (key: keyof CardModel, value: string) => void;
    loading?: boolean;
    card: CardModel;
    errors: Partial<CardModel>;
    fieldStatus?: CardFieldStatus;
    bigger?: boolean;
}

/**
 * The hook will focus the next field if the current field is filled and the condition is true.
 * The codition typically should be true when the current field is valid.
 */
const useAdvancer = (
    currentElementRef: React.RefObject<HTMLInputElement>,
    nextElementRef: React.RefObject<HTMLInputElement>,
    currentFieldState: string,
    condition: boolean
) => {
    useEffect(() => {
        const currentElementFocused = document.activeElement === currentElementRef.current;
        if (condition && currentElementFocused && nextElementRef.current) {
            nextElementRef.current.focus();
        }
    }, [currentFieldState, condition]);
};

const CreditCardNewDesign = ({ card, errors, onChange, loading = false, fieldStatus, bigger = false }: Props) => {
    const narrowNumberRef = useRef<HTMLInputElement>(null);
    const narrowExpRef = useRef<HTMLInputElement>(null);
    const narrowCvcRef = useRef<HTMLInputElement>(null);

    const wideNumberRef = useRef<HTMLInputElement>(null);
    const wideExpRef = useRef<HTMLInputElement>(null);
    const wideCvcRef = useRef<HTMLInputElement>(null);

    const zipRef = useRef<HTMLInputElement>(null);

    useAdvancer(narrowNumberRef, narrowExpRef, card.number, fieldStatus?.number ?? false);
    useAdvancer(narrowExpRef, narrowCvcRef, card.month, fieldStatus?.month ?? false);
    useAdvancer(narrowCvcRef, zipRef, card.cvc, fieldStatus?.cvc ?? false);

    useAdvancer(wideNumberRef, wideExpRef, card.number, fieldStatus?.number ?? false);
    useAdvancer(wideExpRef, wideCvcRef, card.month, fieldStatus?.month ?? false);
    useAdvancer(wideCvcRef, zipRef, card.cvc, fieldStatus?.cvc ?? false);

    const formContainer = useRef<HTMLDivElement>(null);
    const formRect = useElementRect(formContainer, requestAnimationFrameRateLimiter);

    const countries = useMemo(
        () => getFullList().map(({ value, label: text, disabled }) => ({ value, text, disabled })),
        []
    );
    const handleChange =
        (key: keyof CardModel) =>
        ({ target }: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLSelectElement>) =>
            onChange(key, target.value);

    // translator: this is the pattern for bank card expiration MM/YY, where MM stands for Month Month and YY Year Year. Please keep the slash in the middle.
    const patternExpiration = c('Info').t`MM/YY`;

    // translator: this is a ZIP code used for american credit cards
    const zipCode = c('Label, credit card').t`ZIP code`;
    const title = card.country === 'US' ? zipCode : c('Label').t`Postal code`;

    const commonNumberProps = {
        id: 'ccnumber',
        'data-testid': 'ccnumber',
        disableChange: loading,
        autoComplete: 'cc-number',
        name: 'cardnumber',
        maxLength: 23,
    };

    const commonExpProps = {
        id: 'exp',
        disableChange: loading,
        placeholder: patternExpiration,
        'data-testid': 'exp',
        autoComplete: 'cc-exp',
        maxLength: 5,
    };

    const commonCvcProps = {
        autoComplete: 'cc-csc',
        id: 'cvc',
        name: 'cvc',
        'data-testid': 'cvc',
        value: card.cvc,
        onChange: handleChange('cvc'),
        disableChange: loading,
    };

    const { valueWithGaps, bankIcon, niceType, codeName } = formatCreditCardNumber(card.number);
    const { month, year } = card;

    const isNarrow = formRect ? formRect.width < 350 : false;

    let error = null;
    if (errors.number) {
        error = (
            <span data-testid="error-ccnumber" id="error-ccnumber">
                {errors.number}
            </span>
        );
    } else if (errors.month) {
        error = (
            <span data-testid="error-exp" id="error-exp">
                {errors.month}
            </span>
        );
    } else if (errors.cvc) {
        error = (
            <span data-testid="error-cvc" id="error-cvc">
                {errors.cvc}
            </span>
        );
    }

    let creditCardForm;
    if (isNarrow) {
        const cardNumberSuffix = errors.number ? (
            <WarningIcon />
        ) : card.number && bankIcon ? (
            <img src={bankIcon} title={niceType} alt={niceType} width="24" />
        ) : (
            <Icon name="credit-card" size={16} className="mr-1" />
        );

        creditCardForm = (
            <>
                <Label
                    htmlFor={commonNumberProps.id}
                    className="field-two-label field-two-label-container flex pt-3"
                >{c('Label').t`Card information`}</Label>
                <span id="id_desc_card_number" className="sr-only">{c('Label').t`Card number`}</span>
                <Input
                    className="card-number--small"
                    inputClassName="px-3"
                    placeholder={c('Label').t`Card number`}
                    aria-describedby="id_desc_card_number error-ccnumber"
                    value={valueWithGaps}
                    error={errors.number}
                    onChange={({ target }) => {
                        const val = target.value.replace(/\s/g, '');
                        if (isValidNumber(val)) {
                            onChange('number', val);
                        }
                    }}
                    suffix={cardNumberSuffix}
                    ref={narrowNumberRef}
                    {...commonNumberProps}
                />
                <div className="flex">
                    <Label htmlFor={commonExpProps.id} className="sr-only">{c('Label')
                        .t`Expiration (${patternExpiration})`}</Label>
                    <Input
                        inputClassName="px-3"
                        className="exp exp--small"
                        aria-describedby="error-exp"
                        value={`${month}${month.length === 2 || year.length ? '/' : ''}${year}`}
                        error={errors.month}
                        onChange={({ target }) => {
                            const change = handleExpOnChange(target.value, month, year);
                            if (change) {
                                onChange('month', change.month);
                                onChange('year', change.year);
                            }
                        }}
                        ref={narrowExpRef}
                        suffix={errors.month ? <WarningIcon /> : null}
                        {...commonExpProps}
                    />
                    <Label htmlFor={commonCvcProps.id} className="sr-only">{c('Label')
                        .t`Security code (${codeName})`}</Label>
                    <Input
                        placeholder={codeName}
                        inputClassName="px-3"
                        className="cvv cvv--small"
                        aria-describedby="error-cvc"
                        ref={narrowCvcRef}
                        error={errors.cvc}
                        suffix={errors.cvc ? <WarningIcon /> : null}
                        {...commonCvcProps}
                    />
                </div>
            </>
        );
    } else {
        creditCardForm = (
            <>
                <Label
                    htmlFor={commonNumberProps.id}
                    className="field-two-label field-two-label-container flex pt-3"
                >{c('Label').t`Card information`}</Label>
                <span id="id_desc_card_number" className="sr-only">{c('Label').t`Card number`}</span>
                <Input
                    className="card-information"
                    inputClassName="card-number"
                    placeholder={c('Label').t`Card number`}
                    value={valueWithGaps}
                    error={error}
                    aria-describedby="id_desc_card_number error-ccnumber"
                    onChange={({ target }) => {
                        const val = target.value.replace(/\s/g, '');
                        if (isValidNumber(val)) {
                            onChange('number', val);
                        }
                    }}
                    ref={wideNumberRef}
                    prefix={
                        <div className="ml-3 mr-1">
                            {card.number && bankIcon ? (
                                <img src={bankIcon} title={niceType} alt={niceType} width="32" />
                            ) : (
                                <Icon name="credit-card-detailed" size={32} />
                            )}
                        </div>
                    }
                    suffix={
                        <div className="flex mx-0">
                            <Label htmlFor={commonExpProps.id} className="sr-only">{c('Label')
                                .t`Expiration (${patternExpiration})`}</Label>
                            <Input
                                unstyled
                                inputClassName="mr-3 py-0.5 px-3 border-left border-right"
                                className="exp"
                                aria-describedby="error-exp"
                                value={`${month}${month.length === 2 || year.length ? '/' : ''}${year}`}
                                onChange={({ target }) => {
                                    const change = handleExpOnChange(target.value, month, year);
                                    if (change) {
                                        onChange('month', change.month);
                                        onChange('year', change.year);
                                    }
                                }}
                                ref={wideExpRef}
                                {...commonExpProps}
                            />

                            <Label htmlFor={commonCvcProps.id} className="sr-only">{c('Label')
                                .t`Security code (${codeName})`}</Label>
                            <Input
                                unstyled
                                placeholder={codeName}
                                aria-describedby="error-cvc"
                                inputClassName="p-0"
                                className="cvv"
                                ref={wideCvcRef}
                                {...commonCvcProps}
                            />
                        </div>
                    }
                    {...commonNumberProps}
                />
            </>
        );
    }

    return (
        <div ref={formContainer} className={clsx(['field-two-container', bigger && 'field-two--bigger'])}>
            {creditCardForm}
            <div className="error-container mt-1 text-semibold text-sm flex gap-2">
                {error && (
                    <div className="flex">
                        <WarningIcon className="mr-1" />
                        {error}
                    </div>
                )}
            </div>
            <Label htmlFor="postalcode" className="field-two-label field-two-label-container flex pt-1">{c('Label')
                .t`Country`}</Label>
            <Input
                placeholder={title}
                className="country-select flex-justify-space-between divide-x"
                inputClassName="ml-1"
                prefixClassName="flex-item-fluid"
                ref={zipRef}
                prefix={
                    <SelectTwo
                        className="mx-3"
                        unstyled
                        onChange={
                            loading
                                ? undefined
                                : ({ value }: SelectChangeEvent<string>) => {
                                      if (value === DEFAULT_SEPARATOR.value) {
                                          return;
                                      }
                                      onChange('country', value);
                                  }
                        }
                        data-testid="country"
                        id="country"
                        value={card.country}
                    >
                        {countries.map(({ value, text, disabled }) => {
                            return (
                                <Option key={value} value={value} title={text} disabled={disabled}>
                                    {value === DEFAULT_SEPARATOR.value ? <hr className="m-0" /> : text}
                                </Option>
                            );
                        })}
                    </SelectTwo>
                }
                data-testid="postalCode"
                minLength={3}
                maxLength={9}
                autoComplete="postal-code"
                id="postalcode"
                aria-describedby="id_desc_postal"
                value={card.zip}
                onChange={handleChange('zip')}
                disableChange={loading}
                title={title}
                error={errors.zip}
                suffix={errors.zip ? <WarningIcon className="mr-2" /> : null}
            />
            <span className="sr-only" id="id_desc_postal">
                {title}
            </span>
            <div className="error-container mt-1 mb-3 text-semibold text-sm flex">
                {errors.zip && (
                    <>
                        <WarningIcon className="mr-1" />
                        <span data-testid="error-ccnumber">{errors.zip}</span>
                    </>
                )}
            </div>
        </div>
    );
};

export default CreditCardNewDesign;
