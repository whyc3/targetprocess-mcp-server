export async function handleGetCardCurrentStatus(tp, id, resourceType = 'UserStory') {
    const response = await tp.getCardStatus(id, resourceType);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get card status for ${resourceType} id: ${id}`
                }],
        };
    }
    const items = response.items || [];
    if (items.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: `No status data found for ${resourceType} id: ${id}`,
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items[0]) }],
    };
}
