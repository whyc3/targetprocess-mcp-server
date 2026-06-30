export async function handleGetUserById(tp, id) {
    const user = await tp.getUser(id);
    if (!user) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get user, id: ${id}\n JSON: ${JSON.stringify(user, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(user) }],
    };
}
