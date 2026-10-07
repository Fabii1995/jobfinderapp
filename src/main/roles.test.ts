import { describe, expect, it } from 'vitest'
import { classifyRoles, explainRoles } from './roles'

describe('classifyRoles', () => {
  it('title match tags the role, multi-label allowed', () => {
    expect(classifyRoles({ title: 'Junior QA Engineer', description: null })).toEqual(['qa'])
    expect(classifyRoles({ title: 'Python Backend Developer', description: '' }).sort()).toEqual([
      'backend',
      'python'
    ])
    expect(classifyRoles({ title: 'Full Stack | AI Engineer', description: '' }).sort()).toEqual([
      'ai',
      'fullstack'
    ])
    expect(classifyRoles({ title: 'Forward Deployed Engineer', description: '' })).toEqual([
      'forward-deployed'
    ])
  })

  it('>=2 body mentions count', () => {
    const description = 'You will write Python services. Day to day you ship Python code for our platform.'
    expect(classifyRoles({ title: 'Software Engineer', description })).toContain('python')
    expect(explainRoles({ title: 'Software Engineer', description })[0]).toMatchObject({
      role: 'python',
      where: 'description-repeated'
    })
  })

  it('a single body mention does not count', () => {
    expect(classifyRoles({ title: 'Software Engineer', description: 'We use Python for scripts.' })).toEqual([])
  })

  it('"React Native" maps to no role (title and body)', () => {
    expect(classifyRoles({ title: 'React Native Developer', description: '' })).toEqual([])
    expect(
      classifyRoles({
        title: 'Mobile Developer',
        description: 'Build React Native apps. More React Native work.'
      })
    ).toEqual([])
    expect(classifyRoles({ title: 'React Developer', description: '' })).toEqual(['frontend'])
  })

  it('ai body uses narrower keywords: bare "AI" does not count, role-ish phrases do', () => {
    expect(
      classifyRoles({
        title: 'Software Engineer',
        description: 'We are an AI company. AI is our future. AI everywhere.'
      })
    ).not.toContain('ai')
    expect(
      classifyRoles({
        title: 'Software Engineer',
        description: 'You will do machine learning work and LLM integration daily.'
      })
    ).toContain('ai')
    // the broad list applies to the title
    expect(classifyRoles({ title: 'AI Solutions Engineer', description: '' })).toContain('ai')
  })

  it('mentions inside a discipline list are discarded', () => {
    expect(
      classifyRoles({
        title: 'Product Manager',
        description:
          'You work with backend, frontend, product, design. Also backend, frontend, design and product.'
      })
    ).toEqual([])
  })

  it('handles null description', () => {
    expect(classifyRoles({ title: 'Chef', description: null })).toEqual([])
  })
})
