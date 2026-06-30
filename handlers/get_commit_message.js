export async function handleGetCommitMessage(tp, id, type) {
    if (type === 'task') {
        const task = await tp.getTask(id);
        if (!task) {
            return {
                content: [{ type: 'text', text: `Failed to get task with id: ${id}` }],
            };
        }
        const userStory = task.UserStory;
        if (!userStory) {
            return {
                content: [{ type: 'text', text: `Task ${id} has no linked user story` }],
            };
        }
        const feature = userStory.Feature;
        const prefix = feature
            ? `F#${feature.Id} US#${userStory.Id} T#${task.Id}`
            : `US#${userStory.Id} T#${task.Id}`;
        return {
            content: [{ type: 'text', text: `${prefix} ${task.Name}` }],
        };
    }
    const bug = await tp.getBugWithRelations(id);
    if (!bug) {
        return {
            content: [{ type: 'text', text: `Failed to get bug with id: ${id}` }],
        };
    }
    const userStory = bug.UserStory;
    const feature = userStory?.Feature ?? bug.Feature;
    if (!userStory) {
        return {
            content: [{ type: 'text', text: `B#${bug.Id} ${bug.Name}` }],
        };
    }
    const prefix = feature
        ? `F#${feature.Id} US#${userStory.Id} B#${bug.Id}`
        : `US#${userStory.Id} B#${bug.Id}`;
    return {
        content: [{ type: 'text', text: `${prefix} ${bug.Name}` }],
    };
}
