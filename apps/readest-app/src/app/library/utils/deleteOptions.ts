export const shouldShowReadestCloudOnlyDelete = (
  isFixedDriveWebReader: boolean,
  readestCloudActive: boolean,
): boolean => !isFixedDriveWebReader && readestCloudActive;
