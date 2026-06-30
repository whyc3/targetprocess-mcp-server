export async function handleUpdateEpic(tp, params) {
    const response = await tp.updateEpic(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to update epic id: ${params.id}\n JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
    };
}
