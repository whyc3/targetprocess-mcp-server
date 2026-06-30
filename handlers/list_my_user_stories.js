export async function handleListMyUserStories(tp, params) {
    const response = await tp.getMyUserStories(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get user stories, JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    const items = response.Items || [];
    if (items.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: `No user stories assigned to you${params.state ? ` with state "${params.state}"` : ''}`,
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
