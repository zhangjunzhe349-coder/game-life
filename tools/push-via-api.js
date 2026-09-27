#!/usr/bin/env node
/**
 * push-via-api.js —— 当 `github.com` 被墙、`git push` 不通时，改走 `api.github.com` 推送。
 *
 * 与 `git push` 的关键差别：**逐字节复刻提交对象**，所以推完远程 SHA 与本地完全一致、
 * 不会分叉，之后网络恢复时照常 `git push` 即可（不需要 fetch + reset 对账）。
 * 做法：blob 内容一律取自 `git cat-file blob`（绝不读工作区文件 —— 磁盘上是 CRLF、
 * git 里存的是 LF，读工作区会传出不同字节），tree/commit 用 base_tree 增量构造，
 * author/committer 的 name/email/date 全部照抄，最后断言三个 SHA 逐级相等。
 *
 * 用法：
 *   GH_TOKEN=$(gh auth token) node tools/push-via-api.js            # 推送领先远程的提交 + 相关 tag
 *   node tools/push-via-api.js --dry-run                            # 只看要推什么
 *   node tools/push-via-api.js --repo=owner/name --branch=main      # 换仓库/分支
 *
 * 退出码：0 = 已同步或推送成功；1 = 失败（含「远程有本地没有的提交」这类必须人工介入的情况）。
 */
'use strict';
const { execSync } = require('child_process');

const argv = process.argv.slice(2);
const has = (f) => argv.some((a) => a === f || a.startsWith(f + '='));
const val = (f, d) => {
  const hit = argv.find((a) => a.startsWith(f + '='));
  return hit ? hit.slice(f.length + 1) : d;
};

const REPO = val('--repo', 'zhangjunzhe349-coder/game-life');
const BRANCH = val('--branch', 'main');
const DRY = has('--dry-run');
const CWD = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const API = `https://api.github.com/repos/${REPO}`;

const token = process.env.GH_TOKEN || execSync('gh auth token', { encoding: 'utf8' }).trim();
if (!token) { console.error('缺少 GH_TOKEN（可 export GH_TOKEN=$(gh auth token)）'); process.exit(1); }

const git = (args) => execSync(['git'].concat(args).join(' '), { cwd: CWD, encoding: 'buffer', maxBuffer: 1 << 28 });
const gitS = (args) => git(args).toString('utf8').trim();
/**
 * ⚠ 取**提交/标签对象原文**必须用它，不能用 gitS —— `gitS` 的 `.trim()` 会吃掉
 * 消息末尾换行，而 GitHub 是逐字节拿 message 算 SHA 的，少一个 `\n` 就得到一个
 * 完全不同的 commit SHA（表现为「tree 一致但 commit 不一致」，极难排查）。
 */
const gitRaw = (args) => git(args).toString('utf8');

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'game-life-push-via-api',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (res.status === 404) return { __404: true, raw: txt };
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}\n${txt}`);
  return txt ? JSON.parse(txt) : null;
}

function commitMeta(sha) {
  const raw = gitRaw(['cat-file', 'commit', sha]);
  const head = raw.slice(0, raw.indexOf('\n\n'));
  return {
    sha,
    tree: /^tree (\w+)/m.exec(head)[1],
    parent: (/^parent (\w+)/m.exec(head) || [])[1] || null,
    msg: raw.slice(raw.indexOf('\n\n') + 2),
    who: { name: gitS(['show', '-s', '--format=%an', sha]), email: gitS(['show', '-s', '--format=%ae', sha]) },
    date: gitS(['show', '-s', '--format=%aI', sha]),        // author 时间
    cdate: gitS(['show', '-s', '--format=%cI', sha]),       // committer 时间 —— 二者常不同！
  };
}

async function pushBlobs(cache, sha) {
  const full = gitS(['rev-parse', sha]);
  if (cache.has(full)) return cache.get(full);
  const j = await api('POST', `${API}/git/blobs`, {
    content: git(['cat-file', 'blob', full]).toString('base64'),
    encoding: 'base64',
  });
  if (j.sha !== full) throw new Error(`blob 不一致：本地 ${full} ≠ 远程 ${j.sha}`);
  cache.set(full, j.sha);
  return j.sha;
}

function parseRawDiff(from, to) {
  const out = git(['diff', '--raw', '-z', from, to]).toString('utf8');
  const parts = out.split('\0');
  const items = [];
  let i = 0;
  while (i < parts.length) {
    const meta = parts[i++];
    if (!meta) continue;
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/.exec(meta);
    if (!m) throw new Error('无法解析 diff 元信息：' + meta);
    const [, oldMode, newMode, , newSha, status] = m;
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i++];
      const newPath = parts[i++];
      items.push({ kind: status, oldPath, newPath, oldMode, newMode, newSha });
    } else {
      items.push({ kind: status, path: parts[i++], newMode, newSha });
    }
  }
  return items;
}

async function replicate(commitSha, parentSha, blobCache) {
  const m = commitMeta(commitSha);
  if (m.parent !== parentSha) throw new Error(`${commitSha} 的父提交不是 ${parentSha}`);
  if (process.env.PUSH_DEBUG) {
    console.log(`   [debug] msg 长度 ${m.msg.length} 结尾 ${JSON.stringify(m.msg.slice(-14))}`);
    console.log(`   [debug] author ${JSON.stringify(m.who)} ${m.date}`);
  }
  const entries = [];
  for (const it of parseRawDiff(parentSha, commitSha)) {
    if (it.kind === 'R' || it.kind === 'C') {
      entries.push({ path: it.oldPath, mode: it.oldMode, type: 'blob', sha: null });
      entries.push({ path: it.newPath, mode: it.newMode, type: 'blob', sha: await pushBlobs(blobCache, it.newSha) });
      console.log(`   ~ ${it.oldPath} → ${it.newPath}`);
    } else if (it.kind === 'D') {
      entries.push({ path: it.path, mode: it.newMode, type: 'blob', sha: null });
      console.log(`   - ${it.path}`);
    } else {
      entries.push({ path: it.path, mode: it.newMode, type: 'blob', sha: await pushBlobs(blobCache, it.newSha) });
      console.log(`   + ${it.path}`);
    }
  }
  const tree = await api('POST', `${API}/git/trees`, { base_tree: commitMeta(parentSha).tree, tree: entries });
  if (tree.sha !== m.tree) throw new Error(`tree 不一致：本地 ${m.tree} ≠ 远程 ${tree.sha}`);
  const c = await api('POST', `${API}/git/commits`, {
    message: m.msg, tree: tree.sha, parents: [parentSha],
    author: { ...m.who, date: m.date },
    committer: { ...m.who, date: m.cdate },
  });
  if (c.sha !== commitSha) throw new Error(`commit 不一致：本地 ${commitSha} ≠ 远程 ${c.sha}`);
  return c.sha;
}

async function pushTag(tag, commitSha) {
  const remote = await api('GET', `${API}/git/ref/tags/${tag}`);
  if (!remote.__404) {
    if (remote.object && remote.object.sha !== commitSha) {
      console.log(`   tag ${tag} 已存在但指向别的提交，跳过（需人工处理）`);
    } else {
      console.log(`   tag ${tag} 已在远程`);
    }
    return;
  }
  const localSha = gitS(['rev-parse', 'refs/tags/' + tag]);
  const type = gitS(['cat-file', '-t', localSha]);
  if (type === 'commit') {
    // 轻量 tag
    await api('POST', `${API}/git/refs`, { ref: 'refs/tags/' + tag, sha: localSha });
    console.log(`   tag ${tag} → ${localSha}（轻量）`);
    return;
  }
  const raw = gitRaw(['cat-file', '-p', 'refs/tags/' + tag]);
  const head = raw.slice(0, raw.indexOf('\n\n'));
  const tmeta = gitS(['for-each-ref', 'refs/tags/' + tag,
    '--format=%(taggername)%09%(taggeremail)%09%(taggerdate:iso-strict)']).split('\t');
  const obj = await api('POST', `${API}/git/tags`, {
    tag,
    message: raw.slice(raw.indexOf('\n\n') + 2),
    object: /^object (\w+)/m.exec(head)[1],
    type: 'commit',
    tagger: { name: tmeta[0], email: tmeta[1].replace(/^<|>$/g, ''), date: tmeta[2] },
  });
  if (obj.sha !== localSha) throw new Error(`tag 对象不一致：本地 ${localSha} ≠ 远程 ${obj.sha}`);
  await api('POST', `${API}/git/refs`, { ref: 'refs/tags/' + tag, sha: obj.sha });
  console.log(`   tag ${tag} → ${obj.sha}`);
}

(async () => {
  console.log(`仓库 ${REPO} · 分支 ${BRANCH}`);
  const ref = await api('GET', `${API}/git/ref/heads/${BRANCH}`);
  if (ref.__404) { console.error(`远程没有分支 ${BRANCH}，请先手工建仓/建分支`); process.exit(1); }
  const remoteSha = ref.object.sha;
  const localSha = gitS(['rev-parse', BRANCH]);
  console.log(`远程 ${remoteSha}\n本地 ${localSha}`);
  if (remoteSha === localSha) { console.log('\n已是最新，无需推送。'); return; }

  try { gitS(['cat-file', '-e', remoteSha]); } catch {
    console.error('\n远程提交在本地不存在（远程有本地没有的提交）→ 必须人工介入：\n' +
      '  等网络可用时 git fetch + 合并/变基后再推。本工具只做快进，不会覆盖远程。');
    process.exit(1);
  }

  const chain = gitS(['rev-list', '--reverse', `${remoteSha}..${BRANCH}`]).split('\n').filter(Boolean);
  console.log(`\n待推 ${chain.length} 个提交：${chain.map((s) => s.slice(0, 7)).join(' → ')}`);
  if (DRY) { console.log('\n--dry-run：不做任何写操作。'); return; }

  const blobCache = new Map();
  let parent = remoteSha;
  for (const c of chain) {
    console.log(`\n== ${c.slice(0, 7)}（父 ${parent.slice(0, 7)}） ==`);
    parent = await replicate(c, parent, blobCache);
    console.log(`   commit 一致 ✓ ${parent}`);
  }

  await api('PATCH', `${API}/git/refs/heads/${BRANCH}`, { sha: parent, force: false });
  console.log(`\n${BRANCH} → ${parent} ✓`);

  const tags = new Set();
  for (const c of chain) {
    const t = gitS(['tag', '--points-at', c]);
    if (t) t.split('\n').forEach((x) => tags.add(x.trim()));
  }
  if (tags.size) {
    console.log('\n处理 tag：');
    for (const t of tags) await pushTag(t, gitS(['rev-parse', 'refs/tags/' + t]));
  }

  console.log('\n完成：远程与本地 SHA 完全一致，未分叉。');
})().catch((e) => { console.error('\n失败：' + e.message); process.exit(1); });
