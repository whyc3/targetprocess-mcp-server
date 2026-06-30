export async function handleCreateBug(tp, params) {
    const bugResponse = await tp.createBugOnly(params);
    if (!bugResponse) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to create bug "${params.title}"\n JSON: ${JSON.stringify(bugResponse, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(bugResponse) }],
    };
}
