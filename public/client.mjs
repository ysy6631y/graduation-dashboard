import {persistWorkspace} from './workspace-core.mjs';

export async function createWorkspaceClient() {
  const config = globalThis.WORKSPACE_CONFIG || {};
  if (config.url && config.anonKey) {
    const {createCloudClient} = await import('./cloud.mjs');
    return createCloudClient(config);
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new Error('공유 저장소 설정이 필요합니다. 배포 설정을 확인해주세요.');
  }
  return {
    mode: 'local', user: null,
    async read() {
      const response = await fetch('/api/workspace', {cache: 'no-store'});
      if (!response.ok) throw new Error('작업실을 불러오지 못했어요. 다시 연결해주세요.');
      return response.json();
    },
    async compareAndSwap(revision, payload) {
      const response = await fetch('/api/workspace', {
        method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...payload, revision}),
      });
      const data = await response.json();
      if (response.status === 409) return {ok: false, state: data.state};
      if (!response.ok) throw new Error(data.error || '저장하지 못했어요. 다시 시도해주세요.');
      return {ok: true, state: data};
    },
    save(before, proposed) { return persistWorkspace(this, before, proposed); },
  };
}
