export async function handleUpdateBug(tp, params) {
    const bugResponse = await tp.updateBug(params);
    if (!bugResponse) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to update bug "${params.title}"\n JSON: ${JSON.stringify(bugResponse, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(bugResponse) }],
    };
}
