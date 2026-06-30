export async function handleGetEpicFeatures(tp, epicId) {
    const response = await tp.getEpicFeatures(epicId);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get features for epic id: ${epicId}`
                }],
        };
    }
    const features = response.Items ?? [];
    const result = features.map(f => ({
        id: f.Id,
        name: f.Name,
        entityState: f.EntityState?.Name,
        team: f.Team?.Name,
        release: f.Release?.Name,
        progress: f.Progress,
        effort: f.Effort,
    }));
    return {
        content: [{ type: 'text', text: JSON.stringify({ total: result.length, features: result }) }],
    };
}
