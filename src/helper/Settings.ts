import fs from 'fs'
import type { UniDiskConfig, ProviderProfile } from '../types'

// Settings is a singleton that loads configuration from ~/.unidisk/settings.json.
// It can also be seeded directly via set() for testing without a config file.

class SettingsManager {
  private table: Partial<UniDiskConfig> = {}

  load(configPath?: string): void {
    const filePath = configPath ?? `${process.env.HOME}/.unidisk/settings.json`
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      this.table = JSON.parse(raw) as UniDiskConfig
    } catch {
      this.table = {}
    }
  }

  get<K extends keyof UniDiskConfig>(key: K): UniDiskConfig[K] {
    return this.table[key] as UniDiskConfig[K]
  }

  set<K extends keyof UniDiskConfig>(key: K, value: UniDiskConfig[K]): void {
    (this.table as UniDiskConfig)[key] = value
  }

  getProfile(name: string): ProviderProfile {
    const profiles = this.table.profile
    if (!profiles || !profiles[name]) {
      throw new Error(`Settings: profile "${name}" not found`)
    }
    return profiles[name]
  }
}

export const Settings = new SettingsManager()
