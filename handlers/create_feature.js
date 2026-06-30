export async function handleCreateFeature(tp, params) {
    const response = await tp.createFeature(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to create feature "${params.title}"\n JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
    };
}
