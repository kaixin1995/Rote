/**
 * Article changelog 测试
 *
 * 覆盖 apikey（openkey）与认证路由下的 article update/delete 对 rote_changes 的
 * 传播行为，防止 /changes/after 增量同步漏掉绑定 article 的 rote 内容变化。
 *
 * openkey 鉴权：server 端 `isOpenKeyOk` 接受 body.openkey 或 query ?openkey=
 * （见 server/utils/main.ts:88）。本测试统一通过 body 字段传入。
 */

import { TestAssertions } from './utils/assertions';
import { TestClient } from './utils/testClient';
import { TestResultManager } from './utils/testResult';

type RouteKind = 'auth' | 'openkey';

export class ArticleChangelogTestSuite {
  /** 认证客户端（基础 URL 到 /v2/api） */
  private authClient: TestClient;
  /** openkey 客户端（基础 URL 到 /v2/api/openkey） */
  private openkeyClient: TestClient;
  /** 具有全权限的 openkey id（来自 POST /api-keys 创建） */
  private openKey: string;
  private resultManager: TestResultManager;

  private createdNoteIds: string[] = [];
  private createdArticleIds: string[] = [];

  constructor(
    authClient: TestClient,
    openkeyClient: TestClient,
    openKey: string,
    resultManager: TestResultManager
  ) {
    this.authClient = authClient;
    this.openkeyClient = openkeyClient;
    this.openKey = openKey;
    this.resultManager = resultManager;
  }

  // ---------- 基础工具 ----------

  /** 带 openkey 字段的 body */
  private withKey<T extends object>(body: T): T & { openkey: string } {
    return { ...(body as any), openkey: this.openKey };
  }

  /** 通过认证客户端直接创建 rote */
  private async createNote(content = 'article-changelog-test note'): Promise<string | null> {
    const res = await this.authClient.post('/notes', { content });
    if (res.status !== 201) return null;
    const id = (res.data as any)?.data?.id as string | undefined;
    if (id) this.createdNoteIds.push(id);
    return id ?? null;
  }

  /** 通过路径类型创建 article */
  private async createArticle(kind: RouteKind, content: string): Promise<string | null> {
    const res =
      kind === 'auth'
        ? await this.authClient.post('/articles', { content })
        : await this.openkeyClient.post('/articles', this.withKey({ content }));
    if (res.status !== 201) return null;
    const id = (res.data as any)?.data?.id as string | undefined;
    if (id) this.createdArticleIds.push(id);
    return id ?? null;
  }

  /** 将 article 绑定到 note（使用认证路由 /articles/refs/:noteId） */
  private async bindArticleToNote(noteId: string, articleId: string | null): Promise<boolean> {
    const res = await this.authClient.post(`/articles/refs/${noteId}`, { articleId });
    return res.status === 200;
  }

  /** 更新 article */
  private async updateArticle(
    kind: RouteKind,
    articleId: string,
    content: string
  ): Promise<boolean> {
    const res =
      kind === 'auth'
        ? await this.authClient.put(`/articles/${articleId}`, { content })
        : await this.openkeyClient.put(`/articles/${articleId}`, this.withKey({ content }));
    return res.status === 200;
  }

  /** 删除 article */
  private async deleteArticle(kind: RouteKind, articleId: string): Promise<boolean> {
    if (kind === 'auth') {
      const res = await this.authClient.delete(`/articles/${articleId}`);
      return res.status === 200;
    }
    // openkey DELETE 通过 query 传 openkey（server 端同时支持 body 与 query，
    // 但 DELETE 请求约定不带 body，这里走 query 更稳）
    const res = await this.openkeyClient.delete(`/articles/${articleId}?openkey=${this.openKey}`);
    return res.status === 200;
  }

  /** 拉取 timestamp 之后的所有 changes */
  private async changesAfter(timestamp: Date): Promise<any[]> {
    const res = await this.authClient.get(
      `/changes/after?timestamp=${encodeURIComponent(timestamp.toISOString())}&limit=200`
    );
    if (res.status !== 200) return [];
    return ((res.data as any)?.data as any[]) ?? [];
  }

  private filterChanges(changes: any[], roteId: string, action: 'CREATE' | 'UPDATE' | 'DELETE') {
    return changes.filter((c) => c.roteid === roteId && c.action === action);
  }

  private record(name: string, success: boolean, message: string, start: number, error?: any) {
    this.resultManager.recordResult(name, success, message, Date.now() - start, error);
  }

  private async sleep(ms: number) {
    await new Promise((r) => setTimeout(r, ms));
  }

  // ---------- 核心用例 ----------

  /** A1/A3: 绑定 article 的 rote 在 article update 后，changes/after 产生 UPDATE */
  async testUpdateBoundArticleProducesChange(kind: RouteKind) {
    const label = `Article UPDATE propagates change (${kind})`;
    const start = Date.now();
    try {
      const noteId = await this.createNote('note for update-article propagation');
      TestAssertions.assertNotNull(noteId, 'setup: create note');
      const articleId = await this.createArticle(kind, '# original content');
      TestAssertions.assertNotNull(articleId, 'setup: create article');
      const bound = await this.bindArticleToNote(noteId!, articleId!);
      TestAssertions.assert(bound, 'setup: bind article to note');

      // bind 本身会产生一条 UPDATE。基线时间戳放在 bind 之后，update 之前。
      await this.sleep(1100); // 秒级时间戳边界
      const baseline = new Date();

      const ok = await this.updateArticle(kind, articleId!, '# updated content');
      TestAssertions.assert(ok, 'action: update article');

      await this.sleep(500);

      const changes = await this.changesAfter(baseline);
      const matched = this.filterChanges(changes, noteId!, 'UPDATE');
      TestAssertions.assert(
        matched.length >= 1,
        `expected >=1 UPDATE change for bound note after article update, got ${matched.length}`
      );

      this.record(label, true, `matched ${matched.length} UPDATE change(s)`, start);
      return true;
    } catch (error: any) {
      this.record(label, false, error?.message || 'failed', start, error);
      return false;
    }
  }

  /** A2: 未绑定 rote 的 article update 不应写 changelog */
  async testUpdateUnboundArticleNoChange() {
    const label = 'Article UPDATE without bound rote writes no changelog';
    const start = Date.now();
    try {
      const articleId = await this.createArticle('auth', '# standalone article');
      TestAssertions.assertNotNull(articleId, 'setup: create article');

      await this.sleep(1100);
      const baseline = new Date();

      const ok = await this.updateArticle('auth', articleId!, '# standalone updated');
      TestAssertions.assert(ok, 'action: update article');

      await this.sleep(500);

      const changes = await this.changesAfter(baseline);
      const stray = changes.filter((c) => c.originid === articleId);
      TestAssertions.assertEquals(
        stray.length,
        0,
        `expected 0 stray changes for unbound article, got ${stray.length}`
      );

      this.record(label, true, 'no stray changelog entries', start);
      return true;
    } catch (error: any) {
      this.record(label, false, error?.message || 'failed', start, error);
      return false;
    }
  }

  /** B1/B3: 删除绑定 article，rote 仍存在且产生 UPDATE change */
  async testDeleteBoundArticleProducesChange(kind: RouteKind) {
    const label = `Article DELETE propagates change (${kind})`;
    const start = Date.now();
    try {
      const noteId = await this.createNote('note for delete-article propagation');
      TestAssertions.assertNotNull(noteId, 'setup: create note');
      const articleId = await this.createArticle(kind, '# content to be deleted');
      TestAssertions.assertNotNull(articleId, 'setup: create article');
      const bound = await this.bindArticleToNote(noteId!, articleId!);
      TestAssertions.assert(bound, 'setup: bind article');

      await this.sleep(1100);
      const baseline = new Date();

      const ok = await this.deleteArticle(kind, articleId!);
      TestAssertions.assert(ok, 'action: delete article');

      await this.sleep(500);

      const changes = await this.changesAfter(baseline);
      const matched = this.filterChanges(changes, noteId!, 'UPDATE');
      TestAssertions.assert(
        matched.length >= 1,
        `expected >=1 UPDATE change for bound note after article delete, got ${matched.length}`
      );

      // rote 仍存在，且 articleId 为 null
      const noteRes = await this.authClient.get(`/notes/${noteId}`);
      TestAssertions.assertStatus(noteRes.status, 200, 'get note after article delete');
      const noteData = (noteRes.data as any)?.data;
      TestAssertions.assertNotNull(noteData, 'note should still exist');
      TestAssertions.assert(
        noteData.articleId === null || noteData.articleId === undefined,
        `expected note.articleId to be null after article delete, got ${noteData.articleId}`
      );

      this.createdArticleIds = this.createdArticleIds.filter((id) => id !== articleId);

      this.record(label, true, `matched ${matched.length} UPDATE; note intact`, start);
      return true;
    } catch (error: any) {
      this.record(label, false, error?.message || 'failed', start, error);
      return false;
    }
  }

  /** B2: 未绑定 article 删除，不应写 changelog */
  async testDeleteUnboundArticleNoChange() {
    const label = 'Article DELETE without bound rote writes no changelog';
    const start = Date.now();
    try {
      const articleId = await this.createArticle('auth', '# standalone to delete');
      TestAssertions.assertNotNull(articleId, 'setup: create article');

      await this.sleep(1100);
      const baseline = new Date();

      const ok = await this.deleteArticle('auth', articleId!);
      TestAssertions.assert(ok, 'action: delete article');

      await this.sleep(500);

      const changes = await this.changesAfter(baseline);
      const stray = changes.filter((c) => c.originid === articleId);
      TestAssertions.assertEquals(
        stray.length,
        0,
        `expected 0 stray changes for unbound article delete, got ${stray.length}`
      );

      this.createdArticleIds = this.createdArticleIds.filter((id) => id !== articleId);

      this.record(label, true, 'no stray changelog entries', start);
      return true;
    } catch (error: any) {
      this.record(label, false, error?.message || 'failed', start, error);
      return false;
    }
  }

  /** C1: DELETE openkey note 仍只产生 1 条 DELETE change（回归防重复） */
  async testDeleteNoteViaOpenkeyProducesSingleDeleteChange() {
    const label = 'OpenKey DELETE note yields exactly one DELETE change';
    const start = Date.now();
    try {
      const noteId = await this.createNote('note for openkey-delete regression');
      TestAssertions.assertNotNull(noteId, 'setup: create note');

      await this.sleep(1100);
      const baseline = new Date();

      const res = await this.openkeyClient.delete(`/notes/${noteId}?openkey=${this.openKey}`);
      TestAssertions.assertStatus(res.status, 200, 'openkey delete note');

      await this.sleep(500);

      const changes = await this.changesAfter(baseline);
      const deleteEntries = this.filterChanges(changes, noteId!, 'DELETE');
      TestAssertions.assertEquals(
        deleteEntries.length,
        1,
        `expected exactly 1 DELETE change, got ${deleteEntries.length}`
      );

      this.createdNoteIds = this.createdNoteIds.filter((id) => id !== noteId);

      this.record(label, true, 'exactly one DELETE entry', start);
      return true;
    } catch (error: any) {
      this.record(label, false, error?.message || 'failed', start, error);
      return false;
    }
  }

  /** D1: 不存在的 article 更新失败，且不写 changelog */
  async testUpdateNonexistentArticleNoChange() {
    const label = 'UPDATE nonexistent article writes no changelog';
    const start = Date.now();
    try {
      const fakeId = '00000000-0000-4000-8000-000000000000';

      await this.sleep(1100);
      const baseline = new Date();

      const res = await this.authClient.put(`/articles/${fakeId}`, { content: 'x' });
      TestAssertions.assert(
        res.status !== 200,
        `expected non-200 for nonexistent article update, got ${res.status}`
      );

      await this.sleep(500);

      const changes = await this.changesAfter(baseline);
      const stray = changes.filter((c) => c.originid === fakeId || c.roteid === fakeId);
      TestAssertions.assertEquals(stray.length, 0, `expected 0 stray changes, got ${stray.length}`);

      this.record(label, true, 'no stray changelog entries', start);
      return true;
    } catch (error: any) {
      this.record(label, false, error?.message || 'failed', start, error);
      return false;
    }
  }

  async runAll() {
    await this.testUpdateBoundArticleProducesChange('auth');
    await this.testUpdateBoundArticleProducesChange('openkey');
    await this.testUpdateUnboundArticleNoChange();
    await this.testDeleteBoundArticleProducesChange('auth');
    await this.testDeleteBoundArticleProducesChange('openkey');
    await this.testDeleteUnboundArticleNoChange();
    await this.testDeleteNoteViaOpenkeyProducesSingleDeleteChange();
    await this.testUpdateNonexistentArticleNoChange();
  }

  async cleanup() {
    const start = Date.now();
    try {
      for (const id of this.createdNoteIds) {
        try {
          await this.authClient.delete(`/notes/${id}`);
        } catch {
          /* ignore */
        }
      }
      for (const id of this.createdArticleIds) {
        try {
          await this.authClient.delete(`/articles/${id}`);
        } catch {
          /* ignore */
        }
      }
      this.record('Article changelog suite cleanup', true, 'cleanup finished', start);
    } catch (error: any) {
      this.record('Article changelog suite cleanup', false, 'cleanup error', start, error);
    }
  }
}
