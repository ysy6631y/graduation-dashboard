import {createClient} from '@supabase/supabase-js';
import {persistWorkspace, validWorkspace} from './workspace-core.mjs';

export async function createCloudClient({url, anonKey}, clientFactory = createClient) {
  const sdk = clientFactory(url, anonKey, {
    auth: {autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: 'pkce'},
  });
  const {data, error} = await sdk.auth.getSession();
  if (error) throw error;
  let stopRealtime = null;
  const adapter = {
    mode: 'cloud', user: data.session?.user || null, member: null,
    invite: new URLSearchParams(globalThis.location?.hash?.slice(1)||'').get('invite')||'',
    async identity() {
      if (!this.user) return null;
      const {data,error}=await sdk.rpc('get_workspace_identity');
      if(error)throw new Error('작업실 접근 권한을 확인하지 못했어요. 다시 시도해주세요.');
      this.member=data;return data;
    },
    async read() {
      if (!this.user) throw new Error('초대 링크로 들어와주세요.');
      if (!this.member) {
        const identity = await sdk.rpc('get_workspace_identity');
        if (identity.error || !identity.data) throw new Error('초대 링크로 작업실에 참여해주세요.');
        this.member = identity.data;
      }
      const readRow = async () => {
        const {data, error} = await sdk.from('workspace_state').select('payload, revision').eq('id', 1).maybeSingle();
        if (error) throw error;
        return data;
      };
      let row = await readRow();
      if (!row) {
        const {error} = await sdk.rpc('initialize_workspace_state');
        if (error) throw error;
        row = await readRow();
      }
      if (!row || !validWorkspace(row.payload) || !Number.isSafeInteger(row.revision) || row.revision < 0) {
        throw new Error('기존 공유 데이터 형식을 확인해야 해요. 원본은 변경하지 않았습니다.');
      }
      return {...row.payload, revision: row.revision};
    },
    async compareAndSwap(revision, payload) {
      const {data, error} = await sdk.rpc('save_workspace_state', {expected_revision: revision, next_payload: payload});
      if (error) throw new Error(error.code === '42501' ? '팀 접근 권한을 확인해주세요.' : '저장하지 못했어요. 연결을 확인하고 다시 시도해주세요.');
      return {ok: data === true, state: await this.read()};
    },
    save(before, proposed) { return persistWorkspace(this, before, proposed); },
    async join(name) {
      if(!/^[A-Za-z0-9_-]{40,128}$/.test(this.invite))throw new Error('유효한 초대 링크로 들어와주세요.');
      if(!['이유진','임다혜','윤서영','강주원'].includes(name))throw new Error('이름을 선택해주세요.');
      if(!this.user){
        const {data,error}=await sdk.auth.signInAnonymously();
        if(error)throw new Error(error.status===429?'잠시 후 다시 시도해주세요.':'연결하지 못했어요. 잠시 후 다시 시도해주세요.');
        this.user=data.user||data.session?.user;
      }
      const {data,error}=await sdk.rpc('join_workspace',{invite_token:this.invite,member_name:name});
      if(error||!data)throw new Error('만료되었거나 잘못된 초대 링크예요. 팀의 최신 링크를 확인해주세요.');
      this.member=data;
      if(globalThis.location&&globalThis.history){
        const url=new URL(location.href);const hash=new URLSearchParams(url.hash.slice(1));hash.delete('invite');url.hash=hash.toString();
        history.replaceState(null,'',url.href);
      }
      return data;
    },
    async logout() {
      stopRealtime?.(); stopRealtime = null;
      if(this.user){const {error}=await sdk.rpc('leave_workspace');if(error)throw new Error('작업실에서 나가지 못했어요. 다시 시도해주세요.')}
      const {error} = await sdk.auth.signOut();
      if (error) throw error;
      this.user = null; this.member = null; this.invite='';
    },
    onSessionChange(listener) {
      const {data: {subscription}} = sdk.auth.onAuthStateChange((_event, session) => {
        const previous = this.user?.id;
        this.user = session?.user || null;
        if (previous !== this.user?.id) { this.member = null; setTimeout(listener, 0); }
      });
      return () => subscription.unsubscribe();
    },
    subscribe(listener, onStatus) {
      stopRealtime?.();
      const channel = sdk.channel('team-workspace').on('postgres_changes', {
        event: '*', schema: 'public', table: 'workspace_state', filter: 'id=eq.1',
      }, listener).subscribe((status,error)=>onStatus?.(status,error));
      stopRealtime = () => sdk.removeChannel(channel);
      return stopRealtime;
    },
  };
  return adapter;
}
