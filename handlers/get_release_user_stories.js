export async function handleGetReleaseUserStories(tp, name, results, withDescription) {
    const release = await tp.getReleaseUserStories({ name, results, withDescription });
    if (!release) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get ${name} release user stories, JSON: ${JSON.stringify(release, null, 2)}`
                }],
        };
    }
    const items = release.Items || [];
    if (items.length === 0) {
        return {
            content: [{ type: 'text', text: 'No release user stories found' }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
