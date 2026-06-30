export async function handleGetMyTimeLogs(tp, take) {
    const response = await tp.getMyTimeLogs(take);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get time logs, JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    const items = response.Items || [];
    if (items.length === 0) {
        return {
            content: [{ type: 'text', text: 'No time logs found' }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
