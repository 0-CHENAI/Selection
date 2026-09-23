import { expect, it } from 'bun:test'
import { PiEventAdapter } from './event-adapter'
import { messageToStored, storedToMessage } from '@craft-agent/core'

it('segments raw SDK text once and preserves final identity and persisted protocol', () => {
 const adapter = new PiEventAdapter(); adapter.startTurn(); adapter.setPresentationProtocol('marker-v1')
 const raw = '进展\n<<<FINAL_ANSWER>>>\n第一段\n\n第二段'
 const events = [...adapter.adaptEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:raw,partial:{role:'assistant',content:[{type:'text',text:raw}]}}} as never)]
 const delta=events.find(e=>e.type==='text_delta'&&e.phase==='final')
 const finalId=delta?.type === 'text_delta' ? delta.turnId : undefined
 const end=[...adapter.adaptEvent({type:'message_end',message:{role:'assistant',id:'sdk',content:[{type:'text',text:raw}],stopReason:'stop'}} as never)]
 const complete=end.find(e=>e.type==='text_complete')
 expect(complete).toMatchObject({text:'第一段\n\n第二段',turnId:finalId,phase:'final',presentationProtocol:'marker-v1',sdkMessageId:'sdk',relatedTurnIds:[events.find(e => e.type === 'text_complete')?.turnId]})
 const message:any={id:'final',role:'assistant',timestamp:1,content:'第一段\n\n第二段',phase:'final',presentationProtocol:'marker-v1',turnId:finalId,sourceSdkMessageId:'sdk'}
 expect(storedToMessage(messageToStored(message))).toEqual(message)
})

it('emits a final text completion when a stopped Pi message puts the marker last', () => {
 const adapter = new PiEventAdapter(); adapter.startTurn(); adapter.setPresentationProtocol('marker-v1')
 const raw = '自检通过。Sankey 图已完成。\n<<<FINAL_ANSWER>>>'
 const streamed = [...adapter.adaptEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:raw,partial:{role:'assistant',content:[{type:'text',text:raw}]}}} as never)]
 expect(streamed.some(e => e.type === 'text_complete')).toBe(false)
 const ended = [...adapter.adaptEvent({type:'message_end',message:{role:'assistant',id:'sdk',content:[{type:'text',text:raw}],stopReason:'stop'}} as never)]
 expect(ended.filter(e => e.type === 'text_complete')).toEqual([
  expect.objectContaining({text:'自检通过。Sankey 图已完成。\n',isIntermediate:false,phase:'final',presentationProtocol:'marker-v1',sdkMessageId:'sdk'}),
 ])
})

it('keeps a trailing-marker body intermediate when the user stops the Pi turn', () => {
 const adapter = new PiEventAdapter(); adapter.startTurn(); adapter.setPresentationProtocol('marker-v1')
 const raw = '尚未完成。\n<<<FINAL_ANSWER>>>'
 const ended = [...adapter.adaptEvent({type:'message_end',message:{role:'assistant',id:'sdk',content:[{type:'text',text:raw}],stopReason:'aborted',errorMessage:'Request was aborted by the user'}} as never)]
 expect(ended.filter(e => e.type === 'text_complete')).toEqual([
  expect.objectContaining({text:'尚未完成。\n',isIntermediate:true,phase:'intermediate'}),
 ])
})
