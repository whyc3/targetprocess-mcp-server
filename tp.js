import { readFileSync } from "fs";
import { basename } from "path";
import { config } from "./config.js";
export class TpClient {
    baseUrl = config.tp.url;
    token = config.tp.token;
    headers;
    v1 = '/api/v1';
    v2 = '/api/v2';
    constructor() {
        this.headers = {
            "Content-Type": "application/json",
            Accept: "application/json",
        };
    }
    params(params) {
        let _url = this.baseUrl + (params.apiVersion || this.v1);
        for (const segment of params.pathParam) {
            _url += `/${segment}`;
        }
        let _urlParams = [];
        for (const [key, value] of Object.entries(params.param)) {
            _urlParams.push(`${key}=${encodeURIComponent(value)}`);
        }
        return _url + "/?" + _urlParams.join("&");
    }
    // @ts-ignore
    async getAll(params) {
        return (await this.getAllOrNull(params)) || [];
    }
    async getAllOrNull(params) {
        const allItems = [];
        let skip = 0;
        const take = 100;
        while (true) {
            const page = await this.get({
                ...params,
                param: {
                    ...params.param,
                    take,
                    skip,
                },
            });
            if (!page)
                return null;
            if (!page?.Items?.length)
                break;
            allItems.push(...page.Items);
            if (!page.Next)
                break;
            skip += take;
        }
        return allItems;
    }
    async get(params) {
        params.param["access_token"] = this.token;
        let _url = this.params(params);
        try {
            const response = await fetch(_url, {
                method: "GET",
                headers: this.headers
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return (await response.json());
        }
        catch (error) {
            console.error("Error making TP request:", error);
            console.error("Request URL:", _url);
            return null;
        }
    }
    async post(params, data) {
        params.param["access_token"] = this.token;
        let _url = this.params(params);
        console.error(JSON.stringify({ "TP_POST_URL": _url }));
        console.error(JSON.stringify({ "TP_POST_BODY": data }));
        try {
            const response = await fetch(_url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return (await response.json());
        }
        catch (error) {
            console.error("Error making TP request:", error);
            return null;
        }
    }
    // Like post(), but on failure returns the HTTP status and raw response body
    // instead of null, so callers can surface TP's error detail to the user.
    async postRaw(params, data) {
        params.param["access_token"] = this.token;
        let _url = this.params(params);
        console.error(JSON.stringify({ "TP_POST_URL": _url }));
        console.error(JSON.stringify({ "TP_POST_BODY": data }));
        try {
            const response = await fetch(_url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify(data),
            });
            const text = await response.text();
            if (!response.ok) {
                console.error(JSON.stringify({ "TP_POST_ERROR_STATUS": response.status, "TP_POST_ERROR_BODY": text }));
                return { ok: false, status: response.status, body: text };
            }
            return { ok: true, data: (text ? JSON.parse(text) : null) };
        }
        catch (error) {
            console.error("Error making TP request:", error);
            return { ok: false, status: 0, body: String(error) };
        }
    }
    // DELETE request that, like postRaw(), surfaces the HTTP status and raw
    // response body on failure so callers can report TP's error detail.
    async del(params) {
        params.param["access_token"] = this.token;
        let _url = this.params(params);
        console.error(JSON.stringify({ "TP_DELETE_URL": _url }));
        try {
            const response = await fetch(_url, {
                method: "DELETE",
                headers: this.headers,
            });
            const text = await response.text();
            if (!response.ok) {
                console.error(JSON.stringify({ "TP_DELETE_ERROR_STATUS": response.status, "TP_DELETE_ERROR_BODY": text }));
                return { ok: false, status: response.status, body: text };
            }
            return { ok: true, data: (text ? JSON.parse(text) : null) };
        }
        catch (error) {
            console.error("Error making TP request:", error);
            return { ok: false, status: 0, body: String(error) };
        }
    }
    async getUserStory(userStoryId) {
        const response = await this.get({
            pathParam: ["userStories", userStoryId],
            param: { "format": "json" },
        });
        return response;
    }
    async getBug(bugId) {
        const response = await this.get({
            pathParam: ["bugs", bugId],
            param: { "format": "json" }
        });
        return response;
    }
    async getFeature(featureId) {
        const response = await this.get({
            pathParam: ["features", featureId],
            param: { "format": "json" }
        });
        return response;
    }
    async createBug({ title, card, bugContent, origin = "Manual QA", projectId, teamId }) {
        const bug = {
            "Name": title,
            "Project": {
                "Id": projectId || config.tp.projectId
            },
            "customFields": [{
                    "name": "Origin",
                    "type": "DropDown",
                    "value": origin
                }],
            "assignedTeams": [{
                    "team": {
                        "id": teamId || config.tp.teamId
                    }
                }],
            "Description": bugContent,
        };
        if (card.type === "UserStory") {
            bug["UserStory"] = { "Id": card.id };
        }
        else if (card.type === "Feature") {
            bug["Feature"] = { "Id": card.id };
        }
        return this.post({
            pathParam: ["bugs"],
            param: { "format": "json" },
        }, bug);
    }
    async updateUserStorySubState({ id, teamId, teamAssignmentId, entityStateId }) {
        const userStory = { "id": id };
        if (entityStateId)
            userStory["assignedTeams"] = [{
                    "id": teamAssignmentId,
                    "team": {
                        "id": teamId
                    },
                    "entityState": {
                        "id": entityStateId
                    }
                }];
        return this.post({
            pathParam: ["UserStories", id],
            param: { "format": "json" },
        }, userStory);
    }
    async updateUserStory({ id, title, description, projectId, teamId, entityStateId }) {
        const userStory = { "Id": id };
        if (title)
            userStory["Name"] = title;
        if (description)
            userStory["Description"] = description;
        if (projectId)
            userStory["Project"] = { "Id": projectId };
        if (teamId)
            userStory["assignedTeams"] = [{ "team": { "id": teamId } }];
        if (entityStateId)
            userStory["EntityState"] = { "Id": entityStateId };
        return this.post({
            pathParam: ["UserStories"],
            param: { "format": "json" },
        }, userStory);
    }
    async updateBug({ id, title, bugContent, origin, projectId, teamId, entityStateId }) {
        const bug = { "Id": id };
        if (title)
            bug["Name"] = title;
        if (bugContent)
            bug["Description"] = bugContent;
        if (origin)
            bug["customFields"] = [{
                    "name": "Origin",
                    "type": "DropDown",
                    "value": origin
                }];
        if (projectId)
            bug["Project"] = { "Id": projectId };
        if (teamId)
            bug["assignedTeams"] = [{
                    "team": {
                        "id": teamId || config.tp.teamId
                    }
                }];
        if (entityStateId)
            bug["entityState"] = { "id": entityStateId };
        return this.post({
            pathParam: ["bugs"],
            param: { "format": "json" },
        }, bug);
    }
    async createBugOnly({ title, bugContent, origin = "Manual QA", projectId, teamId, entityStateId }) {
        const bug = {
            "Name": title,
            "Project": {
                "Id": projectId || config.tp.projectId
            },
            "customFields": [{
                    "name": "Origin",
                    "type": "DropDown",
                    "value": origin
                }],
            "assignedTeams": [{
                    "team": {
                        "id": teamId || config.tp.teamId
                    }
                }],
            "Description": bugContent,
        };
        if (entityStateId)
            bug["EntityState"] = { "Id": entityStateId };
        return this.post({
            pathParam: ["bugs"],
            param: { "format": "json" },
        }, bug);
    }
    async createUserStory({ title, description, featureId, releaseId, projectId, teamId }) {
        const userStory = {
            "Name": title,
            "Project": { "Id": projectId || config.tp.projectId },
            "assignedTeams": [{ "team": { "id": teamId || config.tp.teamId } }],
        };
        if (description)
            userStory["Description"] = description;
        if (featureId)
            userStory["Feature"] = { "Id": featureId };
        if (releaseId)
            userStory["Release"] = { "Id": releaseId };
        return this.post({
            pathParam: ["UserStories"],
            param: { "format": "json" },
        }, userStory);
    }
    async getEpic(epicId) {
        return this.get({
            pathParam: ["Epics", epicId],
            param: { "format": "json" },
        });
    }
    async updateEpic({ id, title, description, releaseId, projectId }) {
        const epic = { "Id": id };
        if (title)
            epic["Name"] = title;
        if (description)
            epic["Description"] = description;
        if (projectId)
            epic["Project"] = { "Id": projectId };
        if (releaseId)
            epic["Release"] = { "Id": releaseId };
        return this.post({
            pathParam: ["Epics"],
            param: { "format": "json" },
        }, epic);
    }
    async getEpicFeatures(epicId) {
        return this.get({
            pathParam: ["Features"],
            param: {
                "format": "json",
                "where": `Epic.Id eq ${epicId}`,
                "include": "[Id,Name,Description,EntityState[Name],Team[Name],Release[Name],Progress,Effort]",
                "take": 100,
            },
        });
    }
    async createEpic({ title, description, releaseId, projectId }) {
        const epic = {
            "Name": title,
            "Project": { "Id": projectId || config.tp.projectId },
        };
        if (description)
            epic["Description"] = description;
        if (releaseId)
            epic["Release"] = { "Id": releaseId };
        return this.post({
            pathParam: ["Epics"],
            param: { "format": "json" },
        }, epic);
    }
    async createFeature({ title, description, epicId, releaseId, projectId, teamId }) {
        const feature = {
            "Name": title,
            "Project": { "Id": projectId || config.tp.projectId },
            "assignedTeams": [{ "team": { "id": teamId || config.tp.teamId } }],
        };
        if (description)
            feature["Description"] = description;
        if (epicId)
            feature["Epic"] = { "Id": epicId };
        if (releaseId)
            feature["Release"] = { "Id": releaseId };
        return this.post({
            pathParam: ["Features"],
            param: { "format": "json" },
        }, feature);
    }
    async createBugBasedOnUserStory(title, userStoryId, bugContent) {
        const bug = {
            "Name": title,
            "Project": {
                "Id": config.tp.projectId
            },
            "UserStory": {
                "Id": userStoryId
            },
            "customFields": [{
                    "name": "Origin",
                    "type": "DropDown",
                    "value": "Manual QA"
                }],
            "assignedTeams": [{
                    "team": {
                        "id": config.tp.teamId
                    }
                }],
            "Description": bugContent,
        };
        return this.post({
            pathParam: ["bugs"],
            param: { "format": "json" },
        }, bug);
    }
    async createTestCase(name, description, testPlanId) {
        const testCase = {
            "Name": name,
            "Project": { "Id": config.tp.projectId },
            "Description": description,
            "TestPlans": [{
                    "Id": testPlanId
                }],
        };
        return this.post({
            pathParam: ["testCases"],
            param: { "format": "json" },
        }, testCase);
    }
    async updateTestCase({ id, name, description }) {
        const testCase = { "Id": id };
        if (name !== undefined)
            testCase["Name"] = name;
        if (description !== undefined)
            testCase["Description"] = description;
        return this.post({
            pathParam: ["testCases"],
            param: { "format": "json" },
        }, testCase);
    }
    async deleteTestCase(testCaseId) {
        return this.del({
            pathParam: ["testCases", testCaseId],
            param: { "format": "json" },
        });
    }
    async createTestPlan(title, resourceId, resourceType = 'UserStory', options) {
        const testPlan = {
            "Name": `Test Plan: ${title}`,
            "Project": {
                "Id": config.tp.projectId
            },
            "LinkedGeneral": {
                "ResourceType": "General",
                "Id": resourceId,
                "Name": title,
            },
            "LinkedAssignable": {
                "ResourceType": "Assignable",
                "Id": resourceId,
                "Name": title,
            },
        };
        if (resourceType === 'UserStory') {
            testPlan["LinkedUserStory"] = { "ResourceType": "UserStory", "Id": resourceId, "Name": title };
        }
        else if (resourceType === 'Bug') {
            testPlan["LinkedBug"] = { "ResourceType": "Bug", "Id": resourceId, "Name": title };
        }
        else if (resourceType === 'Feature') {
            testPlan["LinkedFeature"] = { "ResourceType": "Feature", "Id": resourceId, "Name": title };
        }
        if (options?.description)
            testPlan["Description"] = options.description;
        if (options?.startDate)
            testPlan["StartDate"] = options.startDate;
        if (options?.endDate)
            testPlan["EndDate"] = options.endDate;
        return this.post({
            pathParam: ["testPlans"],
            param: { "format": "json" },
        }, testPlan);
    }
    async getUser(userId) {
        return this.get({
            pathParam: ["Users", userId],
            param: { "format": "json" },
        });
    }
    async getUsers() {
        return this.get({
            pathParam: ["Users"],
            param: { "format": "json" },
        });
    }
    async addCommentWithUser(userStoryId, comment, user) {
        const userAt = user ? `cc - <div>@user:${user.Email}[${user.FirstName} ${user.LastName}]&nbsp;</div>` : '';
        const commentContent = `${comment}\nn${userAt}`;
        const commentData = {
            description: commentContent,
            owner: {
                id: config.tp.ownerId
            },
            general: {
                id: userStoryId,
            },
        };
        return this.post({
            pathParam: ["comments"],
            param: { "format": "json" },
        }, commentData);
    }
    async addComment(userStoryId, comment) {
        const commentData = {
            description: comment,
            owner: {
                id: config.tp.ownerId
            },
            general: {
                id: userStoryId,
            },
        };
        return this.post({
            pathParam: ["comments"],
            param: { "format": "json" },
        }, commentData);
    }
    async addTestStep(testCaseId, testStep) {
        const testStepData = {
            "Description": testStep.description,
            "Result": testStep.result,
            "TestCase": { "Id": testCaseId },
        };
        return this.post({
            pathParam: ["testSteps"],
            param: { "format": "json" },
        }, testStepData);
    }
    async getTestStep(testStepId) {
        return this.get({
            pathParam: ["testSteps", testStepId],
            param: { "format": "json" },
        });
    }
    async updateTestStep({ id, description, result }) {
        const testStep = { "Id": id };
        if (description !== undefined)
            testStep["Description"] = description;
        if (result !== undefined)
            testStep["Result"] = result;
        return this.post({
            pathParam: ["testSteps"],
            param: { "format": "json" },
        }, testStep);
    }
    async deleteTestStep(testStepId) {
        return this.del({
            pathParam: ["testSteps", testStepId],
            param: { "format": "json" },
        });
    }
    async getBugComments(bugId, results = 25) {
        const response = await this.get({
            pathParam: ["Bugs", bugId, "Comments"],
            param: {
                "format": "json",
                "take": results,
            }
        });
        return response;
    }
    async getUserStoryComments(userStoryId, results = 25) {
        const response = await this.get({
            pathParam: ["UserStories", userStoryId, "Comments"],
            param: {
                "format": "json",
                "take": results,
            }
        });
        return response;
    }
    async searchContainsNameText({ text, entityType }) {
        return this.get({
            pathParam: [entityType],
            param: {
                "format": "json",
                "take": "25",
                "where": `Name contains '${text}'`,
                "include": "[Name, Description, Id]"
            },
        });
    }
    async searchContainsDescriptionText({ text, entityType }) {
        return this.get({
            pathParam: [entityType],
            param: {
                "where": `Description contains '${text}' and EntityState.Name eq 'Done'`,
                "format": "json",
                "take": "50",
            },
        });
    }
    async getCurrentReleases() {
        return this.get({
            pathParam: ["Releases"],
            param: {
                "format": "json",
                "where": `IsCurrent eq 'true'`,
            },
        });
    }
    async getReleaseUserStories({ name, results = 50, withDescription = false }) {
        const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]";
        return this.get({
            pathParam: ["UserStories"],
            param: {
                "format": "json",
                "take": results,
                "where": `Release.Name eq '${name}'`,
                "include": includeFilter,
            }
        });
    }
    async getReleaseOpenUserStories({ name, results = 100, withDescription = false }) {
        const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]";
        return this.get({
            pathParam: ["UserStories"],
            param: {
                "format": "json",
                "take": results,
                "where": `Release.Name eq '${name}' and EntityState.Name ne 'Closed' and EntityState.Name ne 'Done' and EntityState.Name ne 'Passed Dev01  QA' and EntityState.Name ne 'Ready to Deploy to prod'`,
                "include": includeFilter,
            }
        });
    }
    async getReleaseOpenBugs({ name, results = 200, withDescription = false }) {
        const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]";
        return this.get({
            pathParam: ["Bugs"],
            param: {
                "format": "json",
                "take": results,
                "where": `Release.Name eq '${name}' and EntityState.Name ne 'Closed' and EntityState.Name ne 'Done' and EntityState.Name ne 'Passed Dev01  QA' and EntityState.Name ne 'Ready to Deploy to prod'`,
                "include": includeFilter,
            }
        });
    }
    async getReleaseBugs({ name, results = 100, withDescription = false }) {
        const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]";
        return this.get({
            pathParam: ["Bugs"],
            param: {
                "format": "json",
                "take": results,
                "where": `Release.Name eq '${name}'`,
                "include": includeFilter,
            }
        });
    }
    async getReleaseFeatures({ name, results = 50, withDescription = false }) {
        const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]";
        return this.get({
            pathParam: ["Features"],
            param: {
                "format": "json",
                "take": results,
                "where": `Release.Name eq '${name}'`,
                "include": includeFilter,
            }
        });
    }
    async getFeatureUserStories(featureId) {
        return this.get({
            pathParam: ["features"],
            param: {
                "format": "json",
                "where": `(id==${featureId})`,
                "select": `{userStories}`,
            },
            apiVersion: this.v2
        });
    }
    async getUserStoryBugs(userStoryId) {
        return this.get({
            pathParam: ["userstories"],
            param: {
                "format": "json",
                "where": `(id==${userStoryId})`,
                "select": `{bugs}`,
            },
            apiVersion: this.v2
        });
    }
    async getUserStoriesIdsByFeatureId(featureId) {
        return this.get({
            pathParam: ["userstories"],
            param: {
                "format": "json",
                "where": `(Feature.Id==${featureId})`,
                "select": `{id}`,
            },
            apiVersion: this.v2
        });
    }
    async getUserStoryTestPlan(userStoryId) {
        return this.get({
            pathParam: ["userStories", userStoryId],
            param: {
                "format": "json",
                "select": `{id,storyName:name,linkedtestplan}`,
            },
            apiVersion: this.v2
        });
    }
    async getCardTestPlan(cardId, resourceType = 'UserStory') {
        const pathMap = { UserStory: "userStories", Bug: "bugs", Feature: "features" };
        return this.get({
            pathParam: [pathMap[resourceType], cardId],
            param: {
                "format": "json",
                "select": `{id,linkedtestplan}`,
            },
        });
    }
    async getDirectTestPlanTestCases(testPlanId) {
        const testPlan = await this.getTestPlan(testPlanId);
        const testPlanNode = this.toTestPlanNode(testPlan, testPlanId);
        if (!testPlanNode)
            return null;
        const testCases = await this.getDirectTestPlanTestCaseItems(testPlanNode);
        if (!testCases)
            return null;
        return { Next: "", Items: testCases };
    }
    async getTestPlanTestCases(testPlanId) {
        const rootTestPlan = await this.getTestPlan(testPlanId);
        const rootTestPlanNode = this.toTestPlanNode(rootTestPlan, testPlanId);
        if (!rootTestPlanNode)
            return null;
        const queue = [rootTestPlanNode];
        const visitedPlanIds = new Set();
        const seenTestCaseIds = new Set();
        const testCases = [];
        while (queue.length > 0) {
            const testPlan = queue.shift();
            if (visitedPlanIds.has(testPlan.id))
                continue;
            visitedPlanIds.add(testPlan.id);
            const directTestCases = await this.getDirectTestPlanTestCaseItems(testPlan);
            if (!directTestCases)
                return null;
            for (const testCase of directTestCases) {
                const testCaseId = String(testCase.Id);
                if (seenTestCaseIds.has(testCaseId))
                    continue;
                seenTestCaseIds.add(testCaseId);
                testCases.push(testCase);
            }
            const childTestPlans = await this.getChildTestPlanNodes(testPlan.id);
            if (!childTestPlans)
                return null;
            for (const childTestPlan of childTestPlans) {
                if (!visitedPlanIds.has(childTestPlan.id))
                    queue.push(childTestPlan);
            }
        }
        return { Next: "", Items: testCases };
    }
    async getTestPlan(testPlanId) {
        return this.get({
            pathParam: ["testPlans", testPlanId],
            param: { "format": "json" },
        });
    }
    async getDirectTestPlanTestCaseItems(testPlan) {
        const items = await this.getAllOrNull({
            pathParam: ["testPlans", testPlan.id, "testcases"],
            param: { "format": "json" },
        });
        if (!items)
            return null;
        return items.map((item) => ({
            ...item,
            TestPlanId: testPlan.numericId,
            TestPlanName: testPlan.name || item.LinkedTestPlan?.Name,
        }));
    }
    async getChildTestPlanNodes(testPlanId) {
        const items = await this.getAllOrNull({
            pathParam: ["testPlans"],
            param: {
                "format": "json",
                "where": `ParentTestPlans.Id eq ${testPlanId}`,
                "include": "[Id,Name,ParentTestPlans[Id,Name]]",
            },
        });
        if (!items)
            return null;
        return items
            .map((item) => this.toTestPlanNode(item))
            .filter((item) => Boolean(item));
    }
    toTestPlanNode(testPlan, fallbackId) {
        const id = testPlan?.Id ?? fallbackId;
        if (id === undefined || id === null)
            return null;
        const numericId = Number(id);
        return {
            id: String(id),
            numericId: Number.isNaN(numericId) ? 0 : numericId,
            name: testPlan?.Name,
        };
    }
    async getTestCase(testCaseId) {
        return this.get({
            pathParam: ["testCases", testCaseId],
            param: { "format": "json" },
        });
    }
    async getTestCaseSteps(testCaseId) {
        return this.get({
            pathParam: ["testCases", testCaseId, "teststeps"],
            param: { "format": "json" },
        });
    }
    async getProjects() {
        return this.get({
            pathParam: ["Projects"],
            param: { "format": "json" },
        });
    }
    async getProcessWorkflows({ processId }) {
        return this.get({
            pathParam: ["Process"],
            param: {
                "format": "json",
                "where": `id=(${processId})`,
                "select": `{Workflows}`
            },
            apiVersion: this.v2
        });
    }
    async getUserStories({ take = 100 }) {
        return this.get({
            pathParam: ["userStories"],
            param: {
                "format": "json",
                "take": take,
            },
            apiVersion: this.v2
        });
    }
    async getProcesses() {
        return this.get({
            pathParam: ["Processes"],
            param: { "format": "json" },
        });
    }
    async getTeamAssignments() {
        return this.get({
            pathParam: ["TeamAssignments"],
            param: { "format": "json" },
        });
    }
    async getTeams() {
        return this.get({
            pathParam: ["Teams"],
            param: { "format": "json" },
        });
    }
    async getUserStoryWorkflows() {
        return this.get({
            pathParam: ["workflow"],
            param: {
                "format": "json",
                "select": `{Id,Name,Process,EntityType,EntityStates.Select({Id,Name}) as EntityStates}`,
                "where": `(process.id=${config.tp.processId} and entityType.name="userStory" and parentWorkflow=null)`,
                "take": "1",
            },
            apiVersion: this.v2
        });
    }
    async getUserStoryWorkflowsWithSubStates() {
        return this.get({
            pathParam: ["EntityState"],
            param: {
                "format": "json",
                "select": `{id,name,isInitial,isFinal,isDefaultFinal,isPlanned,workflow:{workflow.id,process:{workflow.process.id}},entityType:{entityType.name},subEntityStates:subEntityStates.Select({id,name,entityType:{entityType.name},isInitial,isFinal,isDefaultFinal,isPlanned})}`,
                "where": `(parentEntityState==null and workflow.process.id in [${config.tp.processId}])`,
                "take": "1000",
            },
            apiVersion: this.v2
        });
    }
    async getBugWorkflows() {
        return this.get({
            pathParam: ["workflow"],
            param: {
                "format": "json",
                "select": `{Id,Name,Process,EntityType,EntityStates.Select({Id,Name}) as EntityStates}`,
                "where": `(process.id=${config.tp.processId} and entityType.name="bug" and parentWorkflow=null)`,
                "take": "1",
            },
            apiVersion: this.v2
        });
    }
    async getCardStatus(cardId, resourceType = 'UserStory') {
        const pathMap = { UserStory: 'userStory', Bug: 'bug', Feature: 'feature' };
        return this.get({
            pathParam: [pathMap[resourceType]],
            param: {
                "select": `{Project:{Project.Id},EntityState:{EntityState.Id,EntityState.Name,EntityState.NextStates,EntityState.Workflow.Id as WorkflowId},TeamState:{ResponsibleTeam.Id,Team:{ResponsibleTeam.Team.Id,ResponsibleTeam.Team.Name},EntityState:{ResponsibleTeam.EntityState.Id,ResponsibleTeam.EntityState.Name,ResponsibleTeam.EntityState.Workflow.Id as WorkflowId}},AssignedTeams.Select({TeamAssignmentId:Id,Id:Team.Id,Name:Team.Name}) as Teams}`,
                "where": `(id=${cardId})`,
                "take": "1",
            },
            apiVersion: this.v2
        });
    }
    async getContext() {
        return this.get({
            pathParam: ["Context"],
            param: { "format": "json" }
        });
    }
    async getInProgressTasksAndBugs(userId) {
        const where = `(EntityState.Name eq 'In Progress') and (AssignedUser.Id eq ${userId})`;
        const include = "[Id,Name,EntityState[Name],UserStory[Id,Name,Feature[Id,Name]]]";
        const param = { "format": "json", "where": where, "include": include, "orderByDesc": "ModifyDate" };
        const [tasks, bugs] = await Promise.all([
            this.get({ pathParam: ["Tasks"], param }),
            this.get({ pathParam: ["Bugs"], param }),
        ]);
        return {
            tasks: tasks?.Items ?? [],
            bugs: bugs?.Items ?? [],
        };
    }
    async getTask(taskId) {
        const response = await this.get({
            pathParam: ["Tasks", taskId],
            param: {
                "format": "json",
                "include": "[Id,Name,UserStory[Id,Name,Feature[Id,Name]]]",
            }
        });
        return response;
    }
    async getBugWithRelations(bugId) {
        const response = await this.get({
            pathParam: ["Bugs", bugId],
            param: {
                "format": "json",
                "include": "[Id,Name,UserStory[Id,Name,Feature[Id,Name]]]",
            }
        });
        return response;
    }
    async createTask({ title, description, userStoryId }) {
        const task = {
            "Name": title,
            "Project": {
                "Id": config.tp.projectId
            },
            "UserStory": {
                "Id": userStoryId
            },
        };
        if (description) {
            task["Description"] = description;
        }
        return this.post({
            pathParam: ["Tasks"],
            param: { "format": "json" },
        }, task);
    }
    async logTime({ entityId, entityType, hours, description, date, }) {
        const timestamp = date ? new Date(date).getTime() : Date.now();
        const body = {
            Spent: hours,
            Date: `/Date(${timestamp})/`,
            User: { Id: config.tp.ownerId },
            Assignable: { Id: entityId, ResourceType: entityType },
        };
        if (description)
            body["Description"] = description;
        return this.post({
            pathParam: ["Times"],
            param: { "format": "json" },
        }, body);
    }
    async getMyTimeLogs(take = 25) {
        return this.get({
            pathParam: ["Times"],
            param: {
                "format": "json",
                "where": `User.Id eq ${config.tp.ownerId}`,
                "include": "[Id,Spent,Date,Description,Assignable[Id,Name,ResourceType]]",
                "orderByDesc": "Date",
                "take": take,
            },
        });
    }
    async getMyUserStories({ state, take = 25, skip = 0 }) {
        const whereParts = [`AssignedUser.Id eq ${config.tp.ownerId}`];
        if (state)
            whereParts.push(`EntityState.Name contains '${state}'`);
        return this.get({
            pathParam: ["UserStories"],
            param: {
                "format": "json",
                "where": whereParts.join(' and '),
                "include": "[Id,Name,EntityState[Name],Effort,Project[Name],Feature[Id,Name],CreateDate,ModifyDate]",
                "orderByDesc": "ModifyDate",
                "take": take,
                "skip": skip,
            },
        });
    }
    async getMyBugs({ state, take = 25, skip = 0 }) {
        const whereParts = [`AssignedUser.Id eq ${config.tp.ownerId}`];
        if (state)
            whereParts.push(`EntityState.Name contains '${state}'`);
        return this.get({
            pathParam: ["Bugs"],
            param: {
                "format": "json",
                "where": whereParts.join(' and '),
                "include": "[Id,Name,EntityState[Name],Severity[Name],Priority[Name],Project[Name],UserStory[Id,Name],CreateDate,ModifyDate]",
                "orderByDesc": "ModifyDate",
                "take": take,
                "skip": skip,
            },
        });
    }
    // TP's Relations endpoint silently returns nothing for an OR across
    // Master.Id/Slave.Id, so we query each side separately and merge the results.
    async getCardRelations(cardId) {
        const include = "[Id,RelationType[Name],Master[Id,Name,EntityType],Slave[Id,Name,EntityType]]";
        const query = (side) => this.get({
            pathParam: ["Relations"],
            param: {
                "format": "json",
                "where": `${side}.Id eq ${cardId}`,
                "include": include,
                "take": 100,
            },
        });
        const [asMaster, asSlave] = await Promise.all([query("Master"), query("Slave")]);
        const items = [...(asMaster?.Items ?? []), ...(asSlave?.Items ?? [])];
        return { Next: "", Items: items };
    }
    async getRelationTypes() {
        return this.get({
            pathParam: ["RelationTypes"],
            param: {
                "format": "json",
                "include": "[Id,Name]",
                "take": 100,
            },
        });
    }
    // RelationType must be referenced by Id — passing it by Name makes TP try to
    // create a new RelationType resource, which returns 405 Method Not Allowed.
    async createRelation({ masterId, slaveId, relationTypeId }) {
        const relation = {
            "Master": { "Id": masterId },
            "Slave": { "Id": slaveId },
            "RelationType": { "Id": relationTypeId },
        };
        return this.postRaw({
            pathParam: ["Relations"],
            param: { "format": "json" },
        }, relation);
    }
    async deleteRelation(relationId) {
        return this.del({
            pathParam: ["Relations", relationId],
            param: { "format": "json" },
        });
    }
    async addAttachedFile(generalId, source) {
        let blob;
        let fileName;
        if ("filePath" in source) {
            blob = new Blob([readFileSync(source.filePath)]);
            fileName = basename(source.filePath);
        }
        else {
            blob = new Blob([Buffer.from(source.fileContent, "base64")]);
            fileName = source.fileName;
        }
        const formData = new FormData();
        formData.append("generalId", generalId);
        formData.append("file", blob, fileName);
        const url = `${this.baseUrl}/UploadFile.ashx?access_token=${this.token}`;
        console.error(JSON.stringify({ "UPLOAD_URL": url.replace(this.token, "***") }, null, 2));
        try {
            const response = await fetch(url, {
                method: "POST",
                body: formData,
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.text();
        }
        catch (error) {
            console.error("Error uploading file:", error);
            return null;
        }
    }
}
