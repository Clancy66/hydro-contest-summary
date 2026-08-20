import {
    _, ContestModel, Context, db, Filter,
    Handler, NumberKeys, ObjectId, OplogModel,
    param, PRIV, ProblemModel, Types, UserModel,
    ForbiddenError,
    DomainModel,
    DocumentModel,
} from 'hydrooj';
import { TYPE_CONTEST } from 'hydrooj/src/model/document';

const collsummary = db.collection('summary');

interface SummaryDoc {
    domainId: string,
    owner: number,
    uname: string,
    displayName: string,
    contestId: ObjectId,
    problemId: string,
    pTitle: string,
    content: string,
    updateAt: Date,
    views: number,
    isPublic: boolean,
}
declare module 'hydrooj' {
    interface Model {
        summary: typeof SummaryModel;
    }
    interface Collections {
        summary: SummaryDoc;
    }
}

class SummaryModel {
    static coll = collsummary;

    static async add(
        domainId: string, owner: number, contestId: ObjectId, problemId: string, content: string,
    ): Promise<ObjectId> {
        const udoc = await UserModel.getById(domainId, owner);
        const result = await SummaryModel.coll.insertOne({ 
            domainId,
            owner, 
            uname: udoc.uname,
            displayName: (await DomainModel.getDomainUser(domainId, udoc)).displayName,
            contestId,
            problemId, 
            pTitle: (await ProblemModel.get(domainId, problemId)).title,
            content, 
            updateAt: new Date(), 
            views: 0,
            isPublic: false,
        });

        return result.insertedId;
    }

    static async get(query: Filter<SummaryDoc> = {}): Promise<SummaryDoc> {
        const result = await SummaryModel.coll.findOne(query);
        return result;
    }

    static async getMulti(query: Filter<SummaryDoc> = {}) {
        const result = await SummaryModel.coll.find(query);
        return result;
    }

    static async edit(domainId: string, tid: ObjectId, uid: number, pid: string, content: string): Promise<number> {
        const result = await SummaryModel.coll.updateOne(
            { domainId, contestId: tid, owner: uid, problemId: pid },
            { $set: { content, updateAt: new Date() } }
        );
        return result.modifiedCount;
    }

    static async public(domainId: string, tid: ObjectId, uid: number, pid: string, isPublic: boolean) {
        const result = await SummaryModel.coll.updateOne(
            { domainId, contestId: tid, owner: uid, problemId: pid },
            { $set: { isPublic, updateAt: new Date()  } }
        );
        return result.modifiedCount;
    }

    static async del(domainId: string, tid: ObjectId, uid: number, pid: string): Promise<number> {
        const result = await SummaryModel.coll.deleteOne({ domainId, contestId: tid, owner: uid, problemId: pid });
        return result.deletedCount;
    }

    static async inc(domainId: string, tid: ObjectId, uid: number, pid: string, key: NumberKeys<SummaryDoc>, value: number) {
        const result = await SummaryModel.coll.findOneAndUpdate(
            { domainId, contestId: tid, owner: uid, problemId: pid },
            { $inc: { [key]: value } }
        );
        return result;
    }
}

global.Hydro.model.summary = SummaryModel;

class SummaryHandler extends Handler {
    ddoc?: SummaryModel;

    async _prepare(domainId: string, tid: ObjectId) {
        this.ddoc = await SummaryModel.get({domainId, owner: this.user._id, contestId: tid});
    }
}

class SummaryUserHandler extends SummaryHandler {
    @param('tid', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    async get(domainId: string, tid: ObjectId, page = 1) {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            throw new ForbiddenError('你在此域中无相应权限');
        }

        let query = {domainId, contestId: tid};
        const uidRaw = this.request.query.uid;
        const uid = typeof uidRaw === 'string' ? uidRaw.trim() : '-1';
        if (uid) {
            const uudoc = await UserModel.getById(domainId, +uid);

            if (uudoc) {
                if (!this.user.hasPriv(PRIV.PRIV_SET_PERM) && this.user._id !== uudoc._id) {
                    throw new ForbiddenError('你在此域中无相应权限');
                }
                query['owner'] = uudoc._id;
            }
        }

        const pidRaw = this.request.query.pid;
        const pid = typeof pidRaw === 'string' ? pidRaw.trim() : '';

        if (pid) query['problemId'] = pid;

        const [ddocs, dpcount] = await this.ctx.db.paginate(
            await SummaryModel.getMulti(query),
            page,
            10,
        );

        const tdoc = await ContestModel.get(domainId, tid);
        const tsdoc = this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
            ? await ContestModel.getStatus(domainId, tid, this.user._id)
            : null;
        if (!this.user.hasPriv(PRIV.PRIV_SET_PERM) && (!tsdoc || !tsdoc.startAt || !tsdoc.endAt)) {
            throw new ForbiddenError('暂无查看权限！');
        }
        const tudocs = await DocumentModel.getMultiStatus(domainId, TYPE_CONTEST, {docId: tid}).toArray();
        const uids = [...new Set(tudocs.map(t => t.uid))];
        const users = await UserModel.getMulti({
            _id: { $in: uids }
        }).toArray();

        const userMap = new Map(
            users.map(u => [u._id, u])
        );

        const tudoc = uids
            .map(uid => userMap.get(uid))
            .filter(Boolean);

        const udoc = await UserModel.getById(domainId, this.user._id);
        const pdocs = tdoc.pids?.length
            ? await ProblemModel.getMulti(
                domainId,
                { docId: { $in: tdoc.pids } }
            ).toArray()
            : [];
        const pmap = new Map(
            pdocs.map(p => [p.docId.toString(), p])
        );
        const pdoc = tdoc.pids
            .map(pid => pmap.get(pid.toString()))
            .filter(Boolean);

        const domainUser = await DomainModel.getDomainUser(domainId, udoc);
        if (domainUser) {
            this.response.body.displayName = domainUser.displayName;
        }
        else {
            this.response.body.displayName = '';
        }

        this.response.body = {
            ddocs,
            tdoc,
            tsdoc,
            dpcount,
            udoc,
            pdoc,
            page,
            tudoc,
            uid,
            pid,
            displayName: (await DomainModel.getDomainUser(domainId, udoc)).displayName
        };
        if (!this.user.hasPriv(PRIV.PRIV_SET_PERM)) {
            this.response.redirect = this.url('contest_summary_detail', { tid: tid, pid: pdoc[0].pid });
        }
        else {
            this.response.template = 'contest_summary.html';
        }
    }
}

class SummaryDetailHandler extends SummaryHandler {
    @param('tid', Types.ObjectId)
    @param('pid', Types.String)
    async get({ domainId }, tid: ObjectId, pid: string) {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            throw new ForbiddenError('你在此域中无相应权限');
        }

        const tdoc = await ContestModel.get(domainId, tid);
        const tsdoc = this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
            ? await ContestModel.getStatus(domainId, tid, this.user._id)
            : null;

        let query = {domainId, contestId: tid, problemId: pid};
        const uidRaw = this.request.query.uid;
        const uid = typeof uidRaw === 'string' ? uidRaw.trim() : '-1';
        const uudoc = await UserModel.getById(domainId, +uid);
        if (uudoc) {
            query['owner'] = uudoc._id;
        }
        else {
            query['owner'] = this.user._id;
        }

        const ddoc = await SummaryModel.get(query);
        const udoc = await UserModel.getById(domainId, this.user._id);
        const pdocs = tdoc.pids?.length
            ? await ProblemModel.getMulti(
                domainId,
                { docId: { $in: tdoc.pids } }
            ).toArray()
            : [];
        const pmap = new Map(
            pdocs.map(p => [p.docId.toString(), p])
        );
        const pdoc = tdoc.pids
            .map(pid => pmap.get(pid.toString()))
            .filter(Boolean);

        if (ddoc !== null) {
            const pbRaw = this.request.query.pb;
            const pbstr = typeof pbRaw === 'string' ? pbRaw.trim() : '';
            if (pbstr === "false") {
                if (!this.user.hasPriv(PRIV.PRIV_SET_PERM)) {
                    throw new ForbiddenError('你在此域中无相应权限');
                }
                await Promise.all([
                    SummaryModel.public(domainId, tid, ddoc.owner, pid, false),
                ]);
            }
            else if (pbstr === "true") {
                if (!this.user.hasPriv(PRIV.PRIV_SET_PERM)) {
                    throw new ForbiddenError('你在此域中无相应权限');
                }
                await Promise.all([
                    SummaryModel.public(domainId, tid, ddoc.owner, pid, true),
                ]);
            }
            else {
                if (ddoc.isPublic !== true && ddoc.owner !== this.user._id && !this.user.hasPriv(PRIV.PRIV_SET_PERM)) {
                    throw new ForbiddenError('你在此域中无相应权限');
                }
                await Promise.all([
                    SummaryModel.inc(domainId, tid, ddoc.owner, pid, 'views', 1),
                ]);    
            }
        }

        this.response.body = {
            tdoc, tsdoc, ddoc: await SummaryModel.get(query), udoc, pdoc, pid,
            displayName: (await DomainModel.getDomainUser(domainId, udoc)).displayName,
        };

        this.response.template = 'contest_summary_detail.html';
    }
}

class SummaryEditHandler extends SummaryHandler {
    @param('tid', Types.ObjectId)
    @param('pid', Types.String)
    async get({ domainId }, tid: ObjectId, pid: string) {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            throw new ForbiddenError('你在此域中无相应权限');
        }

        let query = {domainId, contestId: tid, problemId: pid};
        const uidRaw = this.request.query.uid;
        const uid = typeof uidRaw === 'string' ? uidRaw.trim() : '-1';
        const uudoc = await UserModel.getById(domainId, +uid);
        if (uudoc) {
            if (!this.user.hasPriv(PRIV.PRIV_SET_PERM) && this.user._id !== uudoc._id) {
                throw new ForbiddenError();
            }
            query['owner'] = uudoc._id;
        }
        else {
            query['owner'] = this.user._id;
        }

        const tdoc = await ContestModel.get(domainId, tid);
        const tsdoc = this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
            ? await ContestModel.getStatus(domainId, tid, this.user._id)
            : null;
        const ddoc = await SummaryModel.get(query);
        if (ddoc && ddoc.isPublic === true && !this.user.hasPriv(PRIV.PRIV_SET_PERM)) {
            throw new ForbiddenError('不允许修改已公开总结！');
        }
        const udoc = await UserModel.getById(domainId, this.user._id);
        const pdocs = tdoc.pids?.length
            ? await ProblemModel.getMulti(
                domainId,
                { docId: { $in: tdoc.pids } }
            ).toArray()
            : [];
        const pmap = new Map(
            pdocs.map(p => [p.docId.toString(), p])
        );
        const pdoc = tdoc.pids
            .map(pid => pmap.get(pid.toString()))
            .filter(Boolean);

        this.response.template = 'contest_summary_edit.html';
        this.response.body = {
            tdoc, tsdoc, ddoc, udoc, pdoc, pid,
            displayName: (await DomainModel.getDomainUser(domainId, udoc)).displayName,
        };
    }

    async post() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    @param('tid', Types.ObjectId)
    @param('pid', Types.String)
    @param('content', Types.Content)
    async postCreate({ domainId }, tid: ObjectId, pid: string, content: string) {
        
        await this.limitRate('add_Summary', 3600, 60);
        const result = await SummaryModel.add(domainId, this.user._id, tid, pid, content);
        this.response.body = { result };
        this.response.redirect = this.url('contest_summary_detail', { tid: tid, pid: pid });
    }

    @param('tid', Types.ObjectId)
    @param('pid', Types.String)
    @param('content', Types.Content)
    async postUpdate({ domainId }, tid: ObjectId, pid: string, content: string) {
        let query = {domainId, contestId: tid, problemId: pid};
        const uidRaw = this.request.query.uid;
        const uid = typeof uidRaw === 'string' ? uidRaw.trim() : '-1';
        const uudoc = await UserModel.getById(domainId, +uid);
        if (uudoc) {
            if (!this.user.hasPriv(PRIV.PRIV_SET_PERM) && this.user._id !== uudoc._id) {
                throw new ForbiddenError();
            }
            query['owner'] = uudoc._id;
        }
        else {
            query['owner'] = this.user._id;
        }

        const ddoc = await SummaryModel.get(query);
        const result = await Promise.all([
            SummaryModel.edit(domainId, ddoc.contestId, ddoc.owner, ddoc.problemId, content),
            OplogModel.log(this, 'summary.edit', ddoc),
        ]);
        this.response.body = { result };
        this.response.redirect = this.url('contest_summary_detail', { tid: tid, pid: pid }) + `?uid=${query['owner']}`;
    }

    @param('tid', Types.ObjectId)
    @param('pid', Types.String)
    async postDelete({ domainId }, tid: ObjectId, pid: string) {
        let query = {domainId, contestId: tid, problemId: pid};
        const uidRaw = this.request.query.uid;
        const uid = typeof uidRaw === 'string' ? uidRaw.trim() : '-1';
        const uudoc = await UserModel.getById(domainId, +uid);
        if (uudoc) {
            if (!this.user.hasPriv(PRIV.PRIV_SET_PERM) && this.user._id !== uudoc._id) {
                throw new ForbiddenError();
            }
            query['owner'] = uudoc._id;
        }
        else {
            query['owner'] = this.user._id;
        }
        const ddoc = await SummaryModel.get(query);
        await Promise.all([
            SummaryModel.del(domainId, ddoc.contestId, ddoc.owner, ddoc.problemId),
            OplogModel.log(this, 'summary.delete', ddoc),
        ]);
        this.response.redirect = this.url('contest_summary_detail', { tid: tid, pid: pid });
    }
}

export async function apply(ctx: Context) {
    ctx.on('handler/after/ContestDetail#get', async (handler) => {
        try {
            const tid = handler.args?.tid;
            const targetContestId = typeof tid === 'string' ? ObjectId.createFromHexString(tid) : tid;
            const query = {contestId: targetContestId, isPublic: true};
            // @ts-ignore
            const cursor = await SummaryModel.getMulti(query);
            const ddocs = await cursor.toArray();
            handler.response.body.ddocs = ddocs;
        } catch (e) {
            handler.response.body.ddocs = [];
        }
    });

    ctx.Route('contest_summary', '/contest/:tid/summary', SummaryUserHandler, { scope: 'domain' });
    ctx.Route('contest_summary_edit', '/contest/:tid/summary/:pid/edit', SummaryEditHandler, PRIV.PRIV_USER_PROFILE, { scope: 'domain' });
    ctx.Route('contest_summary_detail', '/contest/:tid/summary/:pid', SummaryDetailHandler, { scope: 'domain' });
    ctx.i18n.load('zh', {
        "{0}'s summary of {1}": '{0} 的 {1} 总结',
        "{0}'s summary of problem {1}. {2}": '{0} 的总结：{1}. {2}',
        'View Summary': '查看比赛总结',
        'View Public Summary': '查看公开总结',
        'By User': '由用户',
        'By Problem': '由题目',
        'No user available': '无可用用户',
        'No problem available': '无可用题目',
        'Author': '作者',
        'Date': '日期',
        'UpdateAt': '更新于',
        'Views': '查看次数',
        Summary: '比赛总结',
        Back: '返回',
        summary_detail: '总结详情',
        Public: '公开',
        Private: '取消公开',
        'no summary yet...': '暂无总结...',
        'Click the button below to view, create, or edit summaries for specific problems.': '点击下面的按钮，即可查看、创建或编辑具体题目的总结。',
        'The summary content supports Markdown syntax and can be used to record solution write-ups, post-contest analysis, etc.': '总结内容支持 Markdown 语法，可以用来记录题解、赛后分析等内容。',
        'Featured summaries will be selected by admins and displayed on the contest details page for all contestants.': '优秀总结会被管理员选中展示在比赛详情页中，供所有人参赛选手学习。',
        'Published summaries are visible to all contestants on the contest details page. Private summaries are only visible to you and admins. You can unpublish at any time.': '总结公开之后会展示在比赛详情页中，供所有人参赛选手查看。总结未公开时仅自己和管理员可见，公开后可以随时取消公开。',
    });
}
