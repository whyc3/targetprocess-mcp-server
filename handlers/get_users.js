export async function handleGetUsers(tp) {
    const response = await tp.getUsers();
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get users, JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    const items = response.Items || [];
    if (items.length === 0) {
        return {
            content: [{ type: 'text', text: 'No users found' }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
