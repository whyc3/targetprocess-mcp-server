export async function handleGetReleaseFeatures(tp, name, results) {
    const release = await tp.getReleaseFeatures({ name, results });
    if (!release) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get ${name} release features, JSON: ${JSON.stringify(release, null, 2)}`
                }],
        };
    }
    const items = release.Items || [];
    if (items.length === 0) {
        return {
            content: [{ type: 'text', text: 'No release features found' }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
