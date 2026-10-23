import type { Painter } from './paint';
import type { StyleId } from './style-packs';
import { paintAcademic } from './compose-academic';
import { paintBlueprint } from './compose-blueprint';
import { paintBusiness } from './compose-business';
import { paintDark } from './compose-dark';
import { paintDataBrief } from './compose-data';
import { paintEditorial } from './compose-editorial';
import { paintJournal } from './compose-journal';
import { paintStage } from './compose-stage';
import { paintSwiss } from './compose-swiss';
import { paintWorkshop } from './compose-workshop';

export const PAINTERS: Record<StyleId, (d: Painter) => void> = {
  business: paintBusiness,
  'dark-tech': paintDark,
  'fresh-editorial': paintEditorial,
  'swiss-grid': paintSwiss,
  'academic-paper': paintAcademic,
  workshop: paintWorkshop,
  'data-brief': paintDataBrief,
  'midnight-stage': paintStage,
  blueprint: paintBlueprint,
  'ink-journal': paintJournal,
};
