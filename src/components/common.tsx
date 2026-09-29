import type {ReactNode,ComponentProps} from 'react';
import {LoaderCircle} from 'lucide-react';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from './ui/select';
import {Button} from './ui/button';
export function Choice({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[]}){return <label className="field"><span>{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></label>}
export function Busy({children}:{children:ReactNode}){return <span className="busy"><LoaderCircle size={16} className="spin"/>{children}</span>}
export function IconButton({label,...props}:ComponentProps<typeof Button>&{label:string}){return <Button variant="ghost" size="icon" aria-label={label} title={label} {...props}/>}
export function Empty({title,children,icon}:{title:string;children:ReactNode;icon?:ReactNode}){return <div className="empty">{icon}<h3>{title}</h3><p>{children}</p></div>}
