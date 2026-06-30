import { JSDOM } from 'jsdom';
export async function handleGetBugComments(tp, id, results) {
    const response = await tp.getBugComments(id, results);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get comments for bug id: ${id}`
                }],
        };
    }
    const items = response.Items || [];
    if (items.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: `No comments found for bug id: ${id}`,
                }],
        };
    }
    try {
        const parsedItems = items.map((item) => {
            const dom = new JSDOM(`<html><body><div id="content">${item.Description}</div></body></html>`);
            const descriptionText = dom.window.document.getElementById('content')?.textContent;
            return {
                id: item.Id,
                description: descriptionText,
                createDate: item.CreateDate,
                owner: item.Owner.FullName,
            };
        });
        return {
            content: [{ type: 'text', text: JSON.stringify(parsedItems) }],
        };
    }
    catch (error) {
        console.error('Error parsing bug comments:', error);
        return {
            content: [{
                    type: 'text',
                    text: `Failed to parse bug comments for bug id: ${id}`,
                }],
        };
    }
}
