export async function handleGetCurrentReleases(tp) {
    const releases = await tp.getCurrentReleases();
    if (!releases) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get current releases, JSON: ${JSON.stringify(releases, null, 2)}`
                }],
        };
    }
    const items = releases.Items || [];
    if (items.length === 0) {
        return {
            content: [{ type: 'text', text: 'No releases found' }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
