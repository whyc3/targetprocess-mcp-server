import { JSDOM } from 'jsdom';
export async function handleGetTestPlanById(tp, id) {
    const testPlan = await tp.getTestPlan(id);
    if (!testPlan) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get test plan id: ${id}\n JSON: ${JSON.stringify(testPlan, null, 2)}`
                }],
        };
    }
    let description = '';
    if (testPlan.Description) {
        try {
            const dom = new JSDOM(`<html><body><div id="content">${testPlan.Description}</div></body></html>`);
            description = dom.window.document.getElementById('content')?.textContent || '';
        }
        catch (error) {
            console.error('Error parsing test plan description:', error);
        }
    }
    const result = {
        id: testPlan.Id,
        name: testPlan.Name,
        description,
        entityState: testPlan.EntityState?.Name,
        project: testPlan.Project?.Name,
        linkedUserStory: testPlan.LinkedUserStory?.Name,
        linkedAssignable: testPlan.LinkedAssignable?.Name,
        createDate: testPlan.CreateDate,
        modifyDate: testPlan.ModifyDate,
    };
    return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
    };
}
