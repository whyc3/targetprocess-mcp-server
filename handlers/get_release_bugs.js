export async function handleGetReleaseBugs(tp, name, results) {
    const release = await tp.getReleaseBugs({ name, results });
    if (!release) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get ${name} release bugs, JSON: ${JSON.stringify(release, null, 2)}`
                }],
        };
    }
    const items = release.Items || [];
    if (items.length === 0) {
        return {
            content: [{ type: 'text', text: 'No release bugs found' }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
