export async function handleCreateTask(tp, params) {
    const response = await tp.createTask(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to create task "${params.title}"\n JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
    };
}
