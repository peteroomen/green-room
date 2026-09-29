import {describe,it,expect,vi,afterEach} from 'vitest';
import {Chess,DEFAULT_POSITION,board,move,uci,newGame,commit,exportPgn,importPgn,result,legalLine} from '../src/lib/chess';
import {emptyState,parseBackup,schedule} from '../src/lib/storage';
import {defaults,type Card} from '../src/lib/types';
import {analysisSchema,baseSchema,coachSchema,assertEngineAccess,assertCoachAccess} from '../server/contracts';
import {opponentTools,coachTools,makeOpponent} from '../server/agents';
import {token,validToken,sameOrigin,unlocked} from '../server/security';
import {MockLanguageModelV4} from 'ai/test';
import puzzles from '../src/data/puzzles.json';
import {openings,endings} from '../src/data/drills';
import type {IncomingMessage} from 'node:http';
afterEach(()=>vi.unstubAllEnvs());
describe('chess integrity',()=>{
 it('lists all 20 legal initial moves and rejects illegal ones',()=>{const b=new Chess();expect(b.moves()).toHaveLength(20);expect(()=>move(b,'e2e5')).toThrow();expect(()=>move(b,'e2e4junk')).toThrow()});
 it('supports castling',()=>{const b=new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');expect(move(b,'e1g1').san).toBe('O-O');expect(b.get('f1')?.type).toBe('r')});
 it('supports en passant',()=>{const b=new Chess();for(const m of ['e2e4','a7a6','e4e5','d7d5'])move(b,m);move(b,'e5d6');expect(b.get('d5')).toBeUndefined()});
 it('supports underpromotion',()=>{const b=new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');move(b,'a7a8n');expect(b.get('a8')?.type).toBe('n')});
 it('detects mate',()=>{const b=new Chess();for(const m of ['f2f3','e7e5','g2g4','d8h4'])move(b,m);expect(result(b)).toBe('0-1')});
 it('detects stalemate and insufficient material',()=>{expect(result(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe('1/2-1/2');expect(result(new Chess('7k/8/8/8/8/8/8/K7 w - - 0 1'))).toBe('1/2-1/2')});
 it('preserves repetition history',()=>{const g=newGame();g.moves=['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8'];expect(board(g).isThreefoldRepetition()).toBe(true)});
 it('refuses stale, duplicate, and finished-game writes',()=>{const g=newGame();const next=commit(g,'e2e4',DEFAULT_POSITION,0);expect(()=>commit(next,'d2d4',DEFAULT_POSITION,0)).toThrow();expect(()=>commit({...g,result:'1-0'},'e2e4',DEFAULT_POSITION,0)).toThrow()});
 it('round-trips PGN and custom initial positions',()=>{const g=newGame(defaults,'local','7k/P7/8/8/8/8/8/7K w - - 0 1');g.moves=['a7a8q'];const restored=importPgn(exportPgn(g),defaults);expect(restored.initialFen).toBe(g.initialFen);expect(restored.moves).toEqual(g.moves)});
});
describe('data and practice',()=>{
 it('restores a saved workspace without untrusted review payloads',()=>{const s=emptyState();s.games[0].moves=['e2e4'];const r=parseBackup(JSON.stringify(s));expect(r.games[0].moves).toEqual(['e2e4']);expect(r.current).toBe(s.current)});
 it('rejects corrupt and illegal saved data',()=>{const s=emptyState();s.games[0].moves=['e2e5'];expect(()=>parseBackup(JSON.stringify(s))).toThrow();expect(()=>parseBackup('{}')).toThrow()});
 it('recovers an empty game list with a new board',()=>{const s=emptyState();s.games=[];expect(parseBackup(JSON.stringify(s)).games).toHaveLength(1)});
 it('rejects an invalid practice continuation',()=>{const s=emptyState();s.cards=[{id:'1',fen:DEFAULT_POSITION,solution:'e2e5',line:['e2e5'],source:'test',themes:[],due:0,interval:0,lapses:0}];expect(()=>parseBackup(JSON.stringify(s))).toThrow()});
 it('spaces successes and schedules missed cards soon',()=>{const c:Card={id:'1',fen:DEFAULT_POSITION,solution:'e2e4',line:['e2e4'],source:'test',themes:[],due:0,interval:1,lapses:0};expect(schedule(c,true).interval).toBe(2.3);expect(schedule(c,false).lapses).toBe(1);expect(schedule(c,false).due-Date.now()).toBeLessThanOrEqual(600000)});
 it('has 300 unique puzzles with entirely legal lines',()=>{expect(puzzles).toHaveLength(300);expect(new Set(puzzles.map(p=>p.id)).size).toBe(300);for(const p of puzzles){expect(legalLine(p.fen,p.moves),p.id).toBe(true);expect(p.moves.length).toBeGreaterThan(1)}});
 it('has legal opening drills and playable endgames',()=>{for(const o of openings)expect(legalLine(DEFAULT_POSITION,o.line),o.name).toBe(true);for(const e of endings)expect(new Chess(e.fen).isGameOver()).toBe(false)});
});
function opponentData(){const game=newGame(defaults,'llm');game.moves=['e2e4'];return baseSchema.parse({game,provider:'claude'})}
function coachData(){const g=newGame(defaults,'stockfish');return coachSchema.parse({game:g,provider:'claude',fen:DEFAULT_POSITION,messages:[{role:'user',content:'Help'}],evidence:[],rating:1000,detail:1,level:'plain'})}
describe('agent boundaries',()=>{
 it('strips opponent engine evidence and unrelated prompts',()=>{const parsed=baseSchema.parse({...opponentData(),evidence:[{best:'e7e5'}],messages:[{role:'system',content:'cheat'}]});expect(parsed).not.toHaveProperty('evidence');expect(parsed).not.toHaveProperty('messages')});
 it('always errors on opponent Stockfish access',async()=>{expect(()=>assertEngineAccess('opponent')).toThrow();const t=opponentTools(opponentData(),()=>{});await expect((t.analyzeStockfish.execute as Function)({})).rejects.toThrow('forbidden')});
 it('blocks live LLM coaching and allows completed games',()=>{const d=opponentData();expect(()=>assertCoachAccess(d.game)).toThrow();expect(()=>assertCoachAccess({...d.game,result:'1-0'})).not.toThrow()});
 it('refuses to play on the human’s turn',()=>{const d=opponentData();d.game.moves=[];expect(()=>opponentTools(d,()=>{})).toThrow('turn')});
 it('allows exactly one legal opponent move',async()=>{const select=vi.fn();const t=opponentTools(opponentData(),select);await expect((t.playMove.execute as Function)({move:'e7e4'})).rejects.toThrow();await (t.playMove.execute as Function)({move:'e7e5'});expect(select).toHaveBeenCalledWith('e7e5');await expect((t.playMove.execute as Function)({move:'c7c5'})).rejects.toThrow('already')});
 it('keeps hypothetical lines from changing the live position',async()=>{const d=opponentData();const t=opponentTools(d,()=>{});await (t.exploreLine.execute as Function)({moves:['e7e5','g1f3']});expect(d.game.moves).toEqual(['e2e4'])});
 it('denies explicit demonstrations at gentle hint levels',async()=>{const t=coachTools(coachData(),()=>{});await expect((t.showLine.execute as Function)({moves:['e2e4']})).rejects.toThrow('hidden')});
 it('refuses fabricated engine lines',()=>{expect(()=>analysisSchema.parse({fen:DEFAULT_POSITION,lines:[{move:'e2e5',pv:['e2e5'],cp:12,depth:10}]})).toThrow()});
});
describe('personal access',()=>{
 it('signs expiring sessions and rejects tampering',()=>{vi.stubEnv('APP_PASSWORD','unit-test-password');const t=token();expect(validToken(t)).toBe(true);expect(validToken(t+'a')).toBe(false);expect(validToken('1.deadbeef')).toBe(false)});
 it('rejects cross-origin writes',()=>{expect(sameOrigin({headers:{origin:'https://evil.example',host:'greenroom.example'}} as IncomingMessage)).toBe(false);expect(sameOrigin({headers:{origin:'https://greenroom.example',host:'greenroom.example'}} as IncomingMessage)).toBe(true)});
 it('fails closed for hosted AI without a password',()=>{vi.stubEnv('APP_PASSWORD','');vi.stubEnv('VERCEL','1');expect(unlocked({headers:{}} as IncomingMessage)).toBe(false)});
});
