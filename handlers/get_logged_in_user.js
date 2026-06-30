export async function handleGetLoggedInUser(tp) {
    const ctx = await tp.getContext();
    if (!ctx) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get context, JSON: ${JSON.stringify(ctx, null, 2)}`
                }],
        };
    }
    const loggedInUser = ctx.LoggedUser;
    if (!loggedInUser) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get logged in user in this context, JSON: ${JSON.stringify(ctx, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(loggedInUser) }],
    };
}
