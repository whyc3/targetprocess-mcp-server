export async function handleCreateEpic(tp, params) {
    const response = await tp.createEpic(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to create epic "${params.title}"\n JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
    };
}
