import type { Repository } from 'typeorm'
import { EconomyService } from './economy.service'
import type { UserEntity } from '../user/user.entity'

function createService(user: UserEntity): { service: EconomyService; repo: Repository<UserEntity> } {
  const repo = {
    findOne: jest.fn(async () => user),
    save: jest.fn(async (value: UserEntity) => value),
    createQueryBuilder: jest.fn(() => {
      interface BuilderMock {
        update: () => BuilderMock
        set: (...args: unknown[]) => BuilderMock
        where: (...args: unknown[]) => BuilderMock
        execute: () => Promise<{ affected: number }>
      }
      const builder: BuilderMock = {
        update: jest.fn(() => builder),
        set: jest.fn(() => builder),
        where: jest.fn(() => builder),
        execute: jest.fn(async () => ({ affected: 1 })),
      }
      return builder
    }),
  } as unknown as Repository<UserEntity>
  return { service: new EconomyService(repo), repo }
}

describe('EconomyService stamina rules', () => {
  it('clamps legacy stamina to the P1 cap of 5', async () => {
    const user: UserEntity = {
      id: 1,
      phone: null,
      nickname: null,
      avatar: null,
      level: 1,
      exp: 0,
      rankTier: 1,
      rankScore: 0,
      coins: 0,
      diamonds: 0,
      stamina: 20,
      staminaUpdatedAt: new Date(),
      chapterCurrent: 1,
      createdAt: new Date(),
    }
    const { service, repo } = createService(user)

    await expect(service.getStamina(1)).resolves.toMatchObject({ stamina: 5, max: 5 })
    expect(repo.save).toHaveBeenCalled()
  })

  it('recovers one stamina per hour up to the cap', async () => {
    const user: UserEntity = {
      id: 2,
      phone: null,
      nickname: null,
      avatar: null,
      level: 1,
      exp: 0,
      rankTier: 1,
      rankScore: 0,
      coins: 0,
      diamonds: 0,
      stamina: 4,
      staminaUpdatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      chapterCurrent: 1,
      createdAt: new Date(),
    }
    const { service } = createService(user)

    await expect(service.getStamina(2)).resolves.toMatchObject({ stamina: 5, max: 5, nextRecoverAt: null })
  })
})
