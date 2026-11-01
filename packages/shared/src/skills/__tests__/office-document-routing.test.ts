import { describe, expect, test } from 'bun:test'
import { routeOfficeDocument, routeOfficeDocumentTurn } from '../office-document-routing.ts'

const PHRASES: Record<string, string[]> = {
  contract: [
    '帮我写一份北京两居室的租房合同，月租 6500，押一付三',
    '起草一份劳务协议，岗位是前端开发，试用期三个月',
    '做个采购合同，买 20 台笔记本',
    '写一份保密协议，对方是外包公司',
    '房屋租赁合同里违约责任怎么列',
  ],
  resume: [
    '根据这份 JD 改一下我的简历',
    '帮我写一封产品经理求职信',
    '把我的履历整理成一页中文简历',
    '英文简历和求职信一起做，应聘数据分析师',
  ],
  quotation: [
    '做个报价单：5 台服务器，单价 3.2 万，打 9 折，含 13% 税',
    '给客户出一份设备采购报价，有效期 30 天',
    '报价表里把折扣和税额用公式算出来',
  ],
  budget: [
    '做一份家庭年度预算表',
    '帮我记这个月的家庭收支',
    '个人预算里房租超了，改一下并重算结余',
    '家庭记账表按月汇总',
  ],
  statement: [
    '做一份供应商月度对账单',
    '把这批发货和发票对一下账，标出差异',
    '往来对账表，按币种和税额分开',
  ],
  gantt: [
    '做一个三个月的项目甘特图',
    '排一份项目计划，标出依赖和工期',
    '下周的排班表，用条件格式画出班次',
  ],
  application: [
    '填一张差旅报销申请',
    '写个请假条，下周三到周五年假',
    '做一份用印申请表，必填项标出来',
  ],
  invitation: [
    '写一封公司年会邀请函',
    '做一份周五项目会的会议议程',
    '给客户发一份发布会请柬，写上时间和地点',
  ],
  okr: [
    '做一份季度 OKR 表',
    '绩效考核表，权重要加总校验',
    '这个季度的目标与关键结果，带评分公式',
  ],
  prd: [
    '写一份小程序的产品需求文档',
    '做个 PRD，包含用户故事和验收标准',
    '产品需求说明，背景、目标和里程碑都要有',
  ],
  letter: [
    '写一封英文商务信，邀请对方合作',
    '起草一封正式的英文合作邀约信',
    '用英文写一封商务函，语气正式一点',
  ],
  'gov-doc': [
    '起草一份董事会决议',
    '写一份关于表彰先进的决定',
    '拟一份任免命令',
    '整理一份会议公报',
    '发布一份公开招聘公告',
    '写一份停水通告',
    '起草关于加强安全管理的意见',
    '写一份关于开展质量月的通知',
    '写一份批评通报',
    '向主管机关写一份情况报告',
    '写一份关于购置设备的请示',
    '起草对这份请示的批复',
    '拟一份提请审议的议案',
    '给兄弟单位写一份商洽函',
    '整理一份机关办公会议纪要',
  ],
}

const GOV_KIND: Record<string, string> = {
  '起草一份董事会决议': '决议',
  '写一份关于表彰先进的决定': '决定',
  '拟一份任免命令': '命令',
  '整理一份会议公报': '公报',
  '发布一份公开招聘公告': '公告',
  '写一份停水通告': '通告',
  '起草关于加强安全管理的意见': '意见',
  '写一份关于开展质量月的通知': '通知',
  '写一份批评通报': '通报',
  '向主管机关写一份情况报告': '报告',
  '写一份关于购置设备的请示': '请示',
  '起草对这份请示的批复': '批复',
  '拟一份提请审议的议案': '议案',
  '给兄弟单位写一份商洽函': '函',
  '整理一份机关办公会议纪要': '纪要',
}

describe('office document routing', () => {
  test('each personal and official type hits on realistic Chinese phrasing and no other type', () => {
    const seen = new Map<string, string>()
    for (const [id, phrases] of Object.entries(PHRASES)) {
      expect(phrases.length).toBeGreaterThanOrEqual(3)
      for (const phrase of phrases) {
        const route = routeOfficeDocument(phrase)
        expect(route?.id, phrase).toBe(id)
        expect(seen.get(phrase)).toBeUndefined()
        seen.set(phrase, route!.slug)
        const others = Object.keys(PHRASES).filter(key => key !== id)
        for (const other of others) expect(route?.id, phrase).not.toBe(other)
      }
    }
    expect(new Set(seen.values()).size).toBe(Object.keys(PHRASES).length)
  })

  test('fifteen official kinds stay on the gov skill and name the kind', () => {
    for (const [phrase, kind] of Object.entries(GOV_KIND)) {
      const route = routeOfficeDocument(phrase)
      expect(route, phrase).toMatchObject({ id: 'gov-doc', slug: 'gov-doc-writing', format: 'word', docKind: kind })
    }
  })

  test('lookalikes stay off the neighboring skill', () => {
    expect(routeOfficeDocument('整理一下今天的会议纪要')).toBeNull()
    expect(routeOfficeDocument('帮我做一份产品介绍 PPT')).toBeNull()
    expect(routeOfficeDocument('做一份合同条款的演示文稿')).toBeNull()
    expect(routeOfficeDocument('今天天气怎么样')).toBeNull()
    expect(routeOfficeDocument('劳动合同法规定试用期多久')).toBeNull()
    expect(routeOfficeDocument('根据这份 JD 改一下我的简历')?.id).toBe('resume')
    expect(routeOfficeDocument('写一封英文商务信，邀请对方合作')?.id).toBe('letter')
    expect(routeOfficeDocument('做一份家庭年度预算表')?.id).toBe('budget')
    expect(routeOfficeDocument('做个报价单：5 台服务器')?.id).toBe('quotation')
    expect(routeOfficeDocument('写一封公司年会邀请函')?.id).toBe('invitation')
    expect(routeOfficeDocument('写一份关于开展质量月的通知')?.id).toBe('gov-doc')
    expect(routeOfficeDocument('产品需求说明，背景、目标和里程碑都要有')?.id).toBe('prd')
    expect(routeOfficeDocument('做一份报价单，再做一份对账单')).toBeNull()
    expect(routeOfficeDocument('不要做成 PPT，写成 Word 租房合同')?.id).toBe('contract')
  })

  test('office-mode follow-ups keep the last type; ordinary chat does not', () => {
    const history = ['帮我写一份北京两居室的租房合同，月租 6500，押一付三']
    expect(routeOfficeDocumentTurn({ message: '把押金改成两个月', history, officeMode: true })?.id).toBe('contract')
    expect(routeOfficeDocumentTurn({ message: '把押金改成两个月', history, officeMode: false })).toBeNull()
    expect(routeOfficeDocumentTurn({ message: '改成一份报价单', history, officeMode: true })?.id).toBe('quotation')
  })
})
