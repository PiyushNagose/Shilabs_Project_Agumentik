import { AppError } from "../../../shared/errors.js";
function syncNotImplemented() {
    return new AppError(501, "PROVIDER_ERROR", "Zoho Bigin record synchronization starts in R3");
}
export class ZohoBiginProvider {
    authClient;
    constructor(authClient) {
        this.authClient = authClient;
    }
    verifyConnection() {
        return this.authClient.verifyConnection();
    }
    listContacts(input) {
        return this.authClient.listContactsPage(input);
    }
    listDeals(input) {
        return this.authClient.listDealsPage(input);
    }
    pullLead() {
        return Promise.reject(syncNotImplemented());
    }
    upsertLead() {
        return Promise.reject(syncNotImplemented());
    }
    upsertContact() {
        return Promise.reject(syncNotImplemented());
    }
    upsertDeal() {
        return Promise.reject(syncNotImplemented());
    }
    appendTimelineEvent(input) {
        return this.authClient.appendTimelineEvent(input);
    }
    upsertMeeting() {
        return Promise.reject(syncNotImplemented());
    }
    verifyWebhook() {
        return Promise.reject(syncNotImplemented());
    }
}
