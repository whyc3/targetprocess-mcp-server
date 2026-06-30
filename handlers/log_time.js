export async function handleLogTime(tp, params) {
    const response = await tp.logTime(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to log time on ${params.entityType} id: ${params.entityId}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
    };
}
