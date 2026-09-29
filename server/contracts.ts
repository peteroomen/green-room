import {z} from 'zod';
import {board,legalLine} from '../src/lib/chess';
const uci=z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
export const gameSchema=z.object({id:z.string().max(100),initialFen:z.string().max(100),moves:z.array(uci).max(800),player:z.enum(['w','b']),opponent:z.enum(['stockfish','llm','local']),result:z.enum(['1-0','0-1','1/2-1/2']).optional()});
export const baseSchema=z.object({game:gameSchema,provider:z.enum(['claude','openai','google'])});
export const analysisSchema=z.object({fen:z.string().max(100),lines:z.array(z.object({move:z.string(),pv:z.array(uci).max(100),cp:z.number().finite(),mate:z.number().int().optional(),depth:z.number().int().min(0).max(100)})).max(5)}).refine(a=>{try{board({initialFen:a.fen,moves:[]});return a.lines.every(l=>!l.pv.length||l.move===l.pv[0]&&legalLine(a.fen,l.pv))}catch{return false}},'Illegal engine evidence');
export const coachSchema=baseSchema.extend({fen:z.string().max(100),messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(6000)})).max(30),evidence:z.array(analysisSchema).max(8),rating:z.number().min(100).max(3000),detail:z.number().int().min(1).max(5),level:z.enum(['plain','standard','advanced'])});
export function assertEngineAccess(role:'opponent'|'coach'){if(role==='opponent')throw Error('Engine access is forbidden while playing as an opponent.');}
export function assertCoachAccess(g:z.infer<typeof gameSchema>){const b=board(g);if(g.opponent==='llm'&&!g.result&&!b.isGameOver())throw Error('Finish the LLM game before using coaching or engine analysis.');}
