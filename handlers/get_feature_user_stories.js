export async function handleGetFeatureUserStories(tp, id) {
    const response = await tp.getFeatureUserStories(id);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get user stories for feature id: ${id}`
                }],
        };
    }
    const items = response.items || [];
    if (items.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: `No user stories found in outer items for feature id: ${id}`,
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
