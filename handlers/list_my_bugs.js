export async function handleListMyBugs(tp, params) {
    const response = await tp.getMyBugs(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get bugs, JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    const items = response.Items || [];
    if (items.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: `No bugs assigned to you${params.state ? ` with state "${params.state}"` : ''}`,
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
