'use strict';

const React = require('react');
const Panel = require('./Panel');
const { p, SYM, termWidth } = require('../palette');

function fieldSuggestionsFromIntelligence(snapshot) {
    const arcFields = Array.isArray(snapshot?.arc?.missingFields) ? snapshot.arc.missingFields : [];
    return arcFields
        .map((entry) => String(entry?.field || '').trim())
        .filter(Boolean)
        .filter((field, index, array) => array.indexOf(field) === index)
        .slice(0, 3);
}

function buildCapturePayload(idValue, typeValue, fieldKeys, fieldValues) {
    const fields = { id: String(idValue || '').trim(), type: String(typeValue || '').trim() };
    for (const keyName of Array.isArray(fieldKeys) ? fieldKeys : []) {
        const value = String(fieldValues?.[keyName] || '').trim();
        if (value) fields[keyName] = value;
    }
    return fields;
}

function QuickCapture({ ink, host, port, getTypes, loadTypeArcSuggestions, postNode, onClose, onToast }) {
    const { Box, Text, useInput } = ink;
    const [step, setStep] = React.useState(0);
    const [idValue, setIdValue] = React.useState('');
    const [typeValue, setTypeValue] = React.useState('');
    const [types, setTypes] = React.useState([]);
    const [fieldKeys, setFieldKeys] = React.useState([]);
    const [fieldCursor, setFieldCursor] = React.useState(0);
    const [fieldValues, setFieldValues] = React.useState({});
    const [loadingFields, setLoadingFields] = React.useState(false);
    const [message, setMessage] = React.useState('');

    React.useEffect(() => {
        getTypes({ host, port })
            .then((result) => {
                const next = (Array.isArray(result) ? result : [])
                    .map((entry) => String(entry?.type || '').trim())
                    .filter(Boolean);
                setTypes(next);
            })
            .catch((error) => setMessage(error.message || String(error)));
    }, [getTypes, host, port]);

    const filteredTypes = React.useMemo(() => {
        const needle = typeValue.trim().toLowerCase();
        const matched = types.filter((type) => !needle || type.toLowerCase().includes(needle));
        return matched.slice(0, 4);
    }, [typeValue, types]);

    const activeField = fieldKeys[fieldCursor] || '';

    useInput((input, key) => {
        if (key.escape) { onClose(); return; }
        if (key.backspace || key.delete) {
            if (step === 0) setIdValue((value) => value.slice(0, -1));
            else if (step === 1) setTypeValue((value) => value.slice(0, -1));
            else if (activeField) {
                setFieldValues((current) => ({ ...current, [activeField]: String(current[activeField] || '').slice(0, -1) }));
            }
            return;
        }
        if (key.tab && step === 2 && fieldKeys.length > 0) {
            setFieldCursor((cursor) => (cursor + 1) % fieldKeys.length);
            return;
        }
        if (key.return) {
            if (step === 0) {
                if (!idValue.trim()) { setMessage('id is required'); return; }
                setMessage('');
                setStep(1);
                return;
            }
            if (step === 1) {
                const acceptedType = filteredTypes[0] || typeValue.trim();
                if (!acceptedType) { setMessage('type is required'); return; }
                setTypeValue(acceptedType);
                setLoadingFields(true);
                loadTypeArcSuggestions({ host, port, type: acceptedType })
                    .then((snapshot) => {
                        const nextFields = fieldSuggestionsFromIntelligence(snapshot);
                        setFieldKeys(nextFields);
                        setFieldCursor(0);
                        setFieldValues(Object.fromEntries(nextFields.map((field) => [field, ''])));
                        setLoadingFields(false);
                        setStep(2);
                    })
                    .catch(() => {
                        setFieldKeys([]);
                        setFieldValues({});
                        setFieldCursor(0);
                        setLoadingFields(false);
                        setStep(2);
                    });
                return;
            }
            if (fieldKeys.length > 0 && fieldCursor < fieldKeys.length - 1) {
                setFieldCursor((cursor) => cursor + 1);
                return;
            }
            const fields = buildCapturePayload(idValue, typeValue, fieldKeys, fieldValues);
            postNode({ host, port, fields })
                .then(() => {
                    if (onToast) onToast(`created ${fields.id}`);
                    onClose();
                })
                .catch((error) => setMessage(error.message || String(error)));
            return;
        }
        if (input && input.charCodeAt(0) >= 32) {
            if (step === 0) setIdValue((value) => value + input);
            else if (step === 1) setTypeValue((value) => value + input);
            else if (activeField) setFieldValues((current) => ({ ...current, [activeField]: String(current[activeField] || '') + input }));
        }
    });

    const width = Math.min(termWidth() - 4, 72);
    const marginLeft = Math.max(0, Math.floor((termWidth() - width) / 2));

    return React.createElement(
        Box,
        { flexDirection: 'column', marginLeft, marginTop: 1 },
        React.createElement(Panel, {
            ink,
            title: 'Quick Capture',
            width,
            children: React.createElement(
                Box,
                { flexDirection: 'column' },
                React.createElement(Text, null, '  ' + p.muted('id:   ') + (step === 0 ? p.primary(idValue) + p.accent('█') : p.primary(idValue || ''))),
                React.createElement(Text, null, '  ' + p.muted('type: ') + (step === 1 ? p.primary(typeValue) + p.accent('█') : p.primary(typeValue || ''))),
                step === 1 && filteredTypes.length
                    ? React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
                        ...filteredTypes.map((type, index) => React.createElement(Text, { key: `type-${index}` },
                            '  ' + (index === 0 ? p.accent(`${SYM.cursor} `) : '  ') + p.type(type)
                        ))
                    )
                    : null,
                step === 2
                    ? React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
                        loadingFields
                            ? React.createElement(Text, null, '  ' + p.muted('loading field suggestions...'))
                            : fieldKeys.length
                                ? fieldKeys.map((field, index) => React.createElement(Text, { key: `field-${field}` },
                                    '  ' + (index === fieldCursor ? p.accent(`${SYM.cursor} `) : '  ') +
                                    p.muted(field + ': ') +
                                    (index === fieldCursor ? p.primary(fieldValues[field] || '') + p.accent('█') : p.primary(fieldValues[field] || ''))
                                ))
                                : React.createElement(Text, null, '  ' + p.faint('No suggested fields. Press Enter to create.'))
                    )
                    : null,
                message
                    ? React.createElement(Text, null, '  ' + p.err(message))
                    : null,
                React.createElement(Text, null, ''),
                React.createElement(Text, null,
                    p.faint('  [Enter] next/create  [Tab] next field  [Esc] cancel')
                )
            )
        })
    );
}

QuickCapture.fieldSuggestionsFromIntelligence = fieldSuggestionsFromIntelligence;
QuickCapture.buildCapturePayload = buildCapturePayload;

module.exports = QuickCapture;
