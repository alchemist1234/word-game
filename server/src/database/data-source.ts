import 'reflect-metadata'
import { join } from 'path'
import { DataSource } from 'typeorm'
import { config } from '../common/config'
import { entities } from './entities'

/** CLI/迁移专用 DataSource；应用启动不在此自动跑 migration。 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  entities,
  migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
  synchronize: false,
  migrationsRun: false,
})
