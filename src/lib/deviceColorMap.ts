/**
 * Device color mapping data
 * Format: ProductType/DeviceColor-DeviceEnclosureColor -> Localized color name
 * 
 * This mapping is used to display user-friendly color names
 * based on the device's ProductType, DeviceColor, and DeviceEnclosureColor
 */

import i18n from '../i18n';

export interface DeviceColorKey {
  productType: string;
  deviceColor: string;
  enclosureColor: string;
}

// Color mapping data (English)
export const deviceColorMapEn: Record<string, string> = {
  // iPod touch 4th generation
  "iPod4,1/black-black": "Silver",
  "iPod4,1/white-black": "Silver",
  
  // iPod touch 5th generation
  "iPod5,1/black-black": "Black",
  "iPod5,1/black-silver": "Silver",
  "iPod5,1/white-silver": "Silver",
  "iPod5,1/white-sparrow": "Space Gray",
  "iPod5,1/white-blue": "Blue",
  "iPod5,1/white-pink": "Pink",
  "iPod5,1/white-red": "Red",
  "iPod5,1/white-yellow": "Yellow",
  
  // iPod touch 7th generation
  "iPod7,1/#3b3b3c-#6b6a6d": "Space Gray",
  "iPod7,1/#e1e4e3-#dadcdb": "Silver",
  "iPod7,1/#e1e4e3-#e1ccb7": "Gold",
  "iPod7,1/#e1e4e3-#c6353f": "Red",
  "iPod7,1/#e1e4e3-#458dce": "Blue",
  "iPod7,1/#e1e4e3-#e75090": "Pink",
  
  // iPod touch 9th generation
  "iPod9,1/2-2": "Silver",
  "iPod9,1/2-3": "Gold",
  "iPod9,1/2-4": "Pink",
  "iPod9,1/2-5": "Space Gray",
  "iPod9,1/2-6": "Red",
  "iPod9,1/2-9": "Blue",
  
  // iPad 1st generation
  "iPad1,1/black-silver": "Silver",
  
  // iPad 2
  "iPad2,1/black-silver": "Silver",
  "iPad2,1/white-silver": "Silver",
  "iPad2,2/black-silver": "Silver",
  "iPad2,2/white-silver": "Silver",
  "iPad2,3/black-silver": "Silver",
  "iPad2,3/white-silver": "Silver",
  "iPad2,4/black-silver": "Silver",
  "iPad2,4/white-silver": "Silver",
  "iPad2,5/black-slate": "Black & Slate",
  "iPad2,5/white-silver": "Silver",
  "iPad2,6/black-slate": "Black & Slate",
  "iPad2,6/white-silver": "Silver",
  "iPad2,7/black-slate": "Black & Slate",
  "iPad2,7/white-silver": "Silver",
  
  // iPad 3rd generation
  "iPad3,1/black-silver": "Silver",
  "iPad3,1/white-silver": "Silver",
  "iPad3,2/black-silver": "Silver",
  "iPad3,2/white-silver": "Silver",
  "iPad3,3/black-silver": "Silver",
  "iPad3,3/white-silver": "Silver",
  "iPad3,4/black-silver": "Silver",
  "iPad3,4/white-silver": "Silver",
  "iPad3,5/black-silver": "Silver",
  "iPad3,5/white-silver": "Silver",
  "iPad3,6/black-silver": "Silver",
  "iPad3,6/white-silver": "Silver",
  
  // iPad 4th generation & iPad mini series
  "iPad4,1/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,1/#3b3b3c-#99989b": "Space Gray",
  "iPad4,2/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,2/#3b3b3c-#99989b": "Space Gray",
  "iPad4,3/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,3/#3b3b3c-#99989b": "Space Gray",
  "iPad4,4/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,4/#3b3b3c-#99989b": "Space Gray",
  "iPad4,5/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,5/#3b3b3c-#99989b": "Space Gray",
  "iPad4,6/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,6/#3b3b3c-#99989b": "Space Gray",
  "iPad4,7/#e1e4e3-#e1ccb5": "Gold",
  "iPad4,7/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,7/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad4,8/#e1e4e3-#e1ccb5": "Gold",
  "iPad4,8/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,8/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad4,9/#e1e4e3-#e1ccb5": "Gold",
  "iPad4,9/#e1e4e3-#d7d9d8": "Silver",
  "iPad4,9/#3b3b3c-#b4b5b9": "Space Gray",
  
  // iPad Air & iPad Air 2
  "iPad5,1/#e1e4e3-#e1ccb5": "Gold",
  "iPad5,1/#e1e4e3-#d7d9d8": "Silver",
  "iPad5,1/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad5,2/#e1e4e3-#e1ccb5": "Gold",
  "iPad5,2/#e1e4e3-#d7d9d8": "Silver",
  "iPad5,2/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad5,3/#e1e4e3-#e1ccb5": "Gold",
  "iPad5,3/#e1e4e3-#d7d9d8": "Silver",
  "iPad5,3/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad5,4/#e1e4e3-#e1ccb5": "Gold",
  "iPad5,4/#e1e4e3-#d7d9d8": "Silver",
  "iPad5,4/#3b3b3c-#b4b5b9": "Space Gray",
  
  // iPad mini 4 & iPad (5th gen)
  "iPad6,11/2-3": "Gold",
  "iPad6,11/2-2": "Silver",
  "iPad6,11/1-1": "Space Gray",
  "iPad6,12/2-3": "Gold",
  "iPad6,12/2-2": "Silver",
  "iPad6,12/1-1": "Space Gray",
  
  // iPad Pro 9.7
  "iPad6,3/#e4e7e8-#e4c1b9": "Rose Gold",
  "iPad6,3/#272728-#b9b7ba": "Space Gray",
  "iPad6,3/#e4e7e8-#e1ccb7": "Gold",
  "iPad6,3/#e4e7e8-#dadcdb": "Silver",
  "iPad6,4/#e4e7e8-#e4c1b9": "Rose Gold",
  "iPad6,4/#272728-#b9b7ba": "Space Gray",
  "iPad6,4/#e4e7e8-#e1ccb7": "Gold",
  "iPad6,4/#e4e7e8-#dadcdb": "Silver",
  
  // iPad Pro 12.9 (1st & 2nd gen)
  "iPad6,7/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad6,7/#e1e4e3-#e1ccb5": "Gold",
  "iPad6,7/#e1e4e3-#d7d9d8": "Silver",
  "iPad6,8/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad6,8/#e1e4e3-#e1ccb5": "Gold",
  "iPad6,8/#e1e4e3-#d7d9d8": "Silver",
  
  // iPad Pro 10.5
  "iPad7,1/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad7,1/#e1e4e3-#e1ccb5": "Gold",
  "iPad7,1/#e1e4e3-#d7d9d8": "Silver",
  "iPad7,2/#3b3b3c-#b4b5b9": "Space Gray",
  "iPad7,2/#e1e4e3-#e1ccb5": "Gold",
  "iPad7,2/#e1e4e3-#d7d9d8": "Silver",
  
  // iPad Pro 10.5 & iPad (6th-7th gen)
  "iPad7,3/2-4": "Rose Gold",
  "iPad7,3/1-1": "Space Gray",
  "iPad7,3/2-3": "Gold",
  "iPad7,3/2-2": "Silver",
  "iPad7,4/2-4": "Rose Gold",
  "iPad7,4/1-1": "Space Gray",
  "iPad7,4/2-3": "Gold",
  "iPad7,4/2-2": "Silver",
  "iPad7,5/1-1": "Space Gray",
  "iPad7,5/2-3": "Gold",
  "iPad7,5/2-2": "Silver",
  "iPad7,6/1-1": "Space Gray",
  "iPad7,6/2-3": "Gold",
  "iPad7,6/2-2": "Silver",
  "iPad7,11/1-1": "Space Gray",
  "iPad7,11/2-3": "Gold",
  "iPad7,11/2-2": "Silver",
  "iPad7,12/1-1": "Space Gray",
  "iPad7,12/2-3": "Gold",
  "iPad7,12/2-2": "Silver",
  
  // iPad (8th & 9th gen)
  "iPad11,6/1-1": "Space Gray",
  "iPad11,6/2-3": "Gold",
  "iPad11,6/2-2": "Silver",
  "iPad11,7/1-1": "Space Gray",
  "iPad11,7/2-3": "Gold",
  "iPad11,7/2-2": "Silver",
  "iPad12,1/1-1": "Space Gray",
  "iPad12,1/2-3": "Gold",
  "iPad12,1/2-2": "Silver",
  "iPad12,2/1-1": "Space Gray",
  "iPad12,2/2-3": "Gold",
  "iPad12,2/2-2": "Silver",
  
  // iPad Pro 11 (1st-3rd gen) & iPad Pro 12.9 (3rd-5th gen)
  "iPad8,1/1-1": "Space Gray",
  "iPad8,1/1-2": "Silver",
  "iPad8,2/1-1": "Space Gray",
  "iPad8,2/1-2": "Silver",
  "iPad8,3/1-1": "Space Gray",
  "iPad8,3/1-2": "Silver",
  "iPad8,4/1-1": "Space Gray",
  "iPad8,4/1-2": "Silver",
  "iPad8,5/1-1": "Space Gray",
  "iPad8,5/1-2": "Silver",
  "iPad8,6/1-1": "Space Gray",
  "iPad8,6/1-2": "Silver",
  "iPad8,7/1-1": "Space Gray",
  "iPad8,7/1-2": "Silver",
  "iPad8,8/1-1": "Space Gray",
  "iPad8,8/1-2": "Silver",
  "iPad8,9/1-1": "Space Gray",
  "iPad8,9/1-2": "Silver",
  "iPad8,10/1-1": "Space Gray",
  "iPad8,10/1-2": "Silver",
  "iPad8,11/1-1": "Space Gray",
  "iPad8,11/1-2": "Silver",
  "iPad8,12/1-1": "Space Gray",
  "iPad8,12/1-2": "Silver",
  "iPad13,4/1-1": "Space Gray",
  "iPad13,4/1-2": "Silver",
  "iPad13,5/1-1": "Space Gray",
  "iPad13,5/1-2": "Silver",
  "iPad13,6/1-1": "Space Gray",
  "iPad13,6/1-2": "Silver",
  "iPad13,7/1-1": "Space Gray",
  "iPad13,7/1-2": "Silver",
  "iPad13,8/1-1": "Space Gray",
  "iPad13,8/1-2": "Silver",
  "iPad13,9/1-1": "Space Gray",
  "iPad13,9/1-2": "Silver",
  "iPad13,10/1-1": "Space Gray",
  "iPad13,10/1-2": "Silver",
  "iPad13,11/1-1": "Space Gray",
  "iPad13,11/1-2": "Silver",
  "iPad14,3/1-1": "Space Gray",
  "iPad14,3/1-2": "Silver",
  "iPad14,4/1-1": "Space Gray",
  "iPad14,4/1-2": "Silver",
  "iPad14,5/1-1": "Space Gray",
  "iPad14,5/1-2": "Silver",
  "iPad14,6/1-1": "Space Gray",
  "iPad14,6/1-2": "Silver",
  
  // iPad (10th gen)
  "iPad13,18/1-3": "Yellow",
  "iPad13,18/1-4": "Pink",
  "iPad13,18/1-1": "Silver",
  "iPad13,18/1-2": "Blue",
  "iPad13,19/1-3": "Yellow",
  "iPad13,19/1-4": "Pink",
  "iPad13,19/1-1": "Silver",
  "iPad13,19/1-2": "Blue",
  
  // iPad (11th gen)
  "iPad15,7/1-3": "Yellow",
  "iPad15,7/1-4": "Pink",
  "iPad15,7/1-1": "Silver",
  "iPad15,7/1-2": "Blue",
  "iPad15,8/1-3": "Yellow",
  "iPad15,8/1-4": "Pink",
  "iPad15,8/1-1": "Silver",
  "iPad15,8/1-2": "Blue",
  
  // iPad mini (5th gen)
  "iPad11,1/2-3": "Gold",
  "iPad11,1/2-2": "Silver",
  "iPad11,1/1-1": "Space Gray",
  "iPad11,2/2-3": "Gold",
  "iPad11,2/2-2": "Silver",
  "iPad11,2/1-1": "Space Gray",
  "iPad11,3/2-3": "Gold",
  "iPad11,3/2-2": "Silver",
  "iPad11,3/1-1": "Space Gray",
  "iPad11,4/2-3": "Gold",
  "iPad11,4/2-2": "Silver",
  "iPad11,4/1-1": "Space Gray",
  
  // iPad mini (6th gen)
  "iPad13,1/1-1": "Space Gray",
  "iPad13,1/1-2": "Silver",
  "iPad13,1/1-18": "Green",
  "iPad13,1/1-3": "Rose Gold",
  "iPad13,1/1-4": "Sky Blue",
  "iPad13,2/1-1": "Space Gray",
  "iPad13,2/1-2": "Silver",
  "iPad13,2/1-18": "Green",
  "iPad13,2/1-3": "Rose Gold",
  "iPad13,2/1-4": "Sky Blue",
  
  // iPad Air (4th & 5th gen)
  "iPad13,16/1-1": "Space Black",
  "iPad13,16/1-4": "Blue",
  "iPad13,16/1-6": "Starlight",
  "iPad13,16/1-7": "Purple",
  "iPad13,16/1-3": "Pink",
  "iPad13,17/1-1": "Space Black",
  "iPad13,17/1-4": "Blue",
  "iPad13,17/1-6": "Starlight",
  "iPad13,17/1-7": "Purple",
  "iPad13,17/1-3": "Pink",
  "iPad14,8/1-1": "Space Gray",
  "iPad14,8/1-4": "Blue",
  "iPad14,8/1-6": "Starlight",
  "iPad14,8/1-7": "Purple",
  "iPad14,9/1-1": "Space Gray",
  "iPad14,9/1-4": "Blue",
  "iPad14,9/1-6": "Starlight",
  "iPad14,9/1-7": "Purple",
  "iPad15,3/1-1": "Space Gray",
  "iPad15,3/1-4": "Blue",
  "iPad15,3/1-6": "Starlight",
  "iPad15,3/1-7": "Purple",
  "iPad15,4/1-1": "Space Gray",
  "iPad15,4/1-4": "Blue",
  "iPad15,4/1-6": "Starlight",
  "iPad15,4/1-7": "Purple",
  "iPad14,10/1-1": "Space Gray",
  "iPad14,10/1-4": "Blue",
  "iPad14,10/1-6": "Starlight",
  "iPad14,10/1-7": "Purple",
  "iPad14,11/1-1": "Space Gray",
  "iPad14,11/1-4": "Blue",
  "iPad14,11/1-6": "Starlight",
  "iPad14,11/1-7": "Purple",
  "iPad15,5/1-1": "Space Gray",
  "iPad15,5/1-4": "Blue",
  "iPad15,5/1-6": "Starlight",
  "iPad15,5/1-7": "Purple",
  "iPad15,6/1-1": "Space Gray",
  "iPad15,6/1-4": "Blue",
  "iPad15,6/1-6": "Starlight",
  "iPad15,6/1-7": "Purple",
  
  // iPad Air (M2 & later)
  "iPad14,1/1-3": "Pink",
  "iPad14,1/1-1": "Space Gray",
  "iPad14,1/1-6": "Starlight",
  "iPad14,1/1-7": "Purple",
  "iPad14,1/1-4": "Blue",
  "iPad14,2/1-3": "Pink",
  "iPad14,2/1-1": "Space Gray",
  "iPad14,2/1-6": "Starlight",
  "iPad14,2/1-7": "Purple",
  "iPad14,2/1-4": "Blue",
  "iPad16,1/1-3": "Pink",
  "iPad16,1/1-1": "Space Gray",
  "iPad16,1/1-6": "Starlight",
  "iPad16,1/1-7": "Purple",
  "iPad16,1/1-4": "Blue",
  "iPad16,2/1-3": "Pink",
  "iPad16,2/1-1": "Space Gray",
  "iPad16,2/1-6": "Starlight",
  "iPad16,2/1-7": "Purple",
  "iPad16,2/1-4": "Blue",
  
  // iPad Pro (M2)
  "iPad16,3/1-1": "Space Black",
  "iPad16,3/1-2": "Silver",
  "iPad16,4/1-1": "Space Black",
  "iPad16,4/1-2": "Silver",
  "iPad16,5/1-1": "Space Black",
  "iPad16,5/1-2": "Silver",
  "iPad16,6/1-1": "Space Black",
  "iPad16,6/1-2": "Silver",
  
  // iPhone 3G & 3GS
  "iPhone1,2/black-black": "Black",
  "iPhone1,2/white-white": "White",
  "iPhone2,1/black-black": "Black",
  "iPhone2,1/white-white": "White",
  
  // iPhone 4 & 4S
  "iPhone3,1/black-black": "Black",
  "iPhone3,1/white-white": "White",
  "iPhone3,2/black-black": "Black",
  "iPhone3,2/white-white": "White",
  "iPhone3,3/black-black": "Black",
  "iPhone3,3/white-white": "White",
  "iPhone4,1/black-black": "Black",
  "iPhone4,1/white-white": "White",
  
  // iPhone 5 & 5S
  "iPhone5,1/black-slate": "Black & Slate",
  "iPhone5,1/white-silver": "Silver",
  "iPhone5,1/#e1e4e3-#d7d9d8": "Silver",
  "iPhone5,1/#3b3b3c-#99989b": "Black & Slate",
  "iPhone5,2/black-slate": "Black & Slate",
  "iPhone5,2/white-silver": "Silver",
  "iPhone5,2/#e1e4e3-#d7d9d8": "Silver",
  "iPhone5,2/#3b3b3c-#99989b": "Black & Slate",
  
  // iPhone 5C
  "iPhone5,3/#3b3b3c-#faf189": "Yellow",
  "iPhone5,3/#3b3b3c-#f5f4f7": "White",
  "iPhone5,3/#3b3b3c-#fe767a": "Pink",
  "iPhone5,3/#3b3b3c-#a1e877": "Green",
  "iPhone5,3/#3b3b3c-#46abe0": "Blue",
  "iPhone5,4/#3b3b3c-#faf189": "Yellow",
  "iPhone5,4/#3b3b3c-#f5f4f7": "White",
  "iPhone5,4/#3b3b3c-#fe767a": "Pink",
  "iPhone5,4/#3b3b3c-#a1e877": "Green",
  "iPhone5,4/#3b3b3c-#46abe0": "Blue",
  
  // iPhone 5S
  "iPhone6,1/#e1e4e3-#d4c5b3": "Gold",
  "iPhone6,1/#3b3b3c-#99989b": "Space Gray",
  "iPhone6,1/#e1e4e3-#d7d9d8": "Silver",
  "iPhone6,2/#e1e4e3-#d4c5b3": "Gold",
  "iPhone6,2/#3b3b3c-#99989b": "Space Gray",
  "iPhone6,2/#e1e4e3-#d7d9d8": "Silver",
  
  // iPhone 6 & 6 Plus
  "iPhone7,1/#e1e4e3-#e1ccb5": "Gold",
  "iPhone7,1/#3b3b3c-#b4b5b9": "Space Gray",
  "iPhone7,1/#e1e4e3-#d7d9d8": "Silver",
  "iPhone7,2/#e1e4e3-#e1ccb5": "Gold",
  "iPhone7,2/#3b3b3c-#b4b5b9": "Space Gray",
  "iPhone7,2/#e1e4e3-#d7d9d8": "Silver",
  
  // iPhone 6S & 6S Plus
  "iPhone8,1/#e4e7e8-#e1ccb7": "Gold",
  "iPhone8,1/#e4e7e8-#e1ccb5": "Gold",
  "iPhone8,1/#e4e7e8-#e4c1b9": "Rose Gold",
  "iPhone8,1/2-4": "Rose Gold",
  "iPhone8,1/#272728-#b9b7ba": "Space Gray",
  "iPhone8,1/1-1": "Space Gray",
  "iPhone8,1/#e1e4e3-#dadcdb": "Silver",
  "iPhone8,2/#e4e7e8-#e1ccb7": "Gold",
  "iPhone8,2/#e4e7e8-#e1ccb5": "Gold",
  "iPhone8,2/#e4e7e8-#e4c1b9": "Rose Gold",
  "iPhone8,2/2-4": "Rose Gold",
  "iPhone8,2/#272728-#b9b7ba": "Space Gray",
  "iPhone8,2/1-1": "Space Gray",
  "iPhone8,2/#e1e4e3-#dadcdb": "Silver",
  
  // iPhone SE (1st gen)
  "iPhone8,4/#c8caca-#e5bdb5": "Rose Gold",
  "iPhone8,4/#c8caca-#d6c8b9": "Gold",
  "iPhone8,4/#121211-#aeb1b8": "Space Gray",
  "iPhone8,4/#c8caca-#dcdede": "Silver",
  
  // iPhone 7 & 7 Plus
  "iPhone9,1/1-1": "Black",
  "iPhone9,1/2-4": "Rose Gold",
  "iPhone9,1/2-3": "Gold",
  "iPhone9,1/1-5": "Jet Black",
  "iPhone9,1/2-2": "Silver",
  "iPhone9,1/2-6": "Red",
  "iPhone9,2/1-1": "Black",
  "iPhone9,2/2-4": "Rose Gold",
  "iPhone9,2/2-3": "Gold",
  "iPhone9,2/1-5": "Jet Black",
  "iPhone9,2/2-2": "Silver",
  "iPhone9,2/2-6": "Red",
  "iPhone9,3/1-1": "Black",
  "iPhone9,3/2-4": "Rose Gold",
  "iPhone9,3/2-3": "Gold",
  "iPhone9,3/1-5": "Jet Black",
  "iPhone9,3/2-2": "Silver",
  "iPhone9,3/2-6": "Red",
  "iPhone9,4/1-1": "Black",
  "iPhone9,4/2-4": "Rose Gold",
  "iPhone9,4/2-3": "Gold",
  "iPhone9,4/1-5": "Jet Black",
  "iPhone9,4/2-2": "Silver",
  "iPhone9,4/2-6": "Red",
  
  // iPhone 8 & 8 Plus
  "iPhone10,1/1-8": "Space Gray",
  "iPhone10,1/1-1": "Space Gray",
  "iPhone10,1/2-7": "Gold",
  "iPhone10,1/2-3": "Gold",
  "iPhone10,1/2-2": "Silver",
  "iPhone10,1/1-6": "Red",
  "iPhone10,2/1-8": "Space Gray",
  "iPhone10,2/1-1": "Space Gray",
  "iPhone10,2/2-7": "Gold",
  "iPhone10,2/2-3": "Gold",
  "iPhone10,2/2-2": "Silver",
  "iPhone10,2/1-6": "Red",
  "iPhone10,4/1-8": "Space Gray",
  "iPhone10,4/1-1": "Space Gray",
  "iPhone10,4/2-7": "Gold",
  "iPhone10,4/2-3": "Gold",
  "iPhone10,4/2-2": "Silver",
  "iPhone10,4/1-6": "Red",
  "iPhone10,5/1-8": "Space Gray",
  "iPhone10,5/1-1": "Space Gray",
  "iPhone10,5/2-7": "Gold",
  "iPhone10,5/2-3": "Gold",
  "iPhone10,5/2-2": "Silver",
  "iPhone10,5/1-6": "Red",
  
  // iPhone X
  "iPhone10,3/1-1": "Space Gray",
  "iPhone10,3/1-2": "Silver",
  "iPhone10,6/1-1": "Space Gray",
  "iPhone10,6/1-2": "Silver",
  
  // iPhone XS & XS Max
  "iPhone11,2/1-1": "Space Gray",
  "iPhone11,2/1-2": "Silver",
  "iPhone11,2/1-4": "Gold",
  "iPhone11,4/1-1": "Space Gray",
  "iPhone11,4/1-2": "Silver",
  "iPhone11,4/1-4": "Gold",
  "iPhone11,6/1-1": "Space Gray",
  "iPhone11,6/1-2": "Silver",
  "iPhone11,6/1-4": "Gold",
  
  // iPhone XR
  "iPhone11,8/1-1": "Black",
  "iPhone11,8/1-2": "White",
  "iPhone11,8/1-7": "Yellow",
  "iPhone11,8/1-8": "Coral",
  "iPhone11,8/1-9": "Blue",
  "iPhone11,8/1-6": "Red",
  
  // iPhone 11
  "iPhone12,1/1-1": "Black",
  "iPhone12,1/1-2": "White",
  "iPhone12,1/1-6": "Red",
  "iPhone12,1/1-7": "Yellow",
  "iPhone12,1/1-17": "Purple",
  "iPhone12,1/1-18": "Green",
  
  // iPhone 11 Pro & 11 Pro Max
  "iPhone12,3/1-1": "Space Gray",
  "iPhone12,3/1-2": "Silver",
  "iPhone12,3/1-4": "Gold",
  "iPhone12,3/1-18": "Midnight Green",
  "iPhone12,5/1-1": "Space Gray",
  "iPhone12,5/1-2": "Silver",
  "iPhone12,5/1-4": "Gold",
  "iPhone12,5/1-18": "Midnight Green",
  
  // iPhone SE (2nd gen)
  "iPhone12,8/1-1": "Black",
  "iPhone12,8/1-2": "White",
  "iPhone12,8/1-6": "Red",
  
  // iPhone SE (3rd gen)
  "iPhone14,6/1-1": "Midnight",
  "iPhone14,6/1-2": "Starlight",
  "iPhone14,6/1-6": "Red",
  
  // iPhone 12 Pro & 12 Pro Max
  "iPhone13,3/1-2": "Silver",
  "iPhone13,3/1-3": "Gold",
  "iPhone13,3/1-9": "Pacific Blue",
  "iPhone13,3/1-1": "Graphite",
  "iPhone13,4/1-2": "Silver",
  "iPhone13,4/1-3": "Gold",
  "iPhone13,4/1-9": "Pacific Blue",
  "iPhone13,4/1-1": "Graphite",
  
  // iPhone 12 & 12 mini
  "iPhone13,1/1-2": "White",
  "iPhone13,1/1-1": "Black",
  "iPhone13,1/1-9": "Blue",
  "iPhone13,1/1-18": "Green",
  "iPhone13,1/1-17": "Purple",
  "iPhone13,1/1-6": "Red",
  "iPhone13,2/1-2": "White",
  "iPhone13,2/1-1": "Black",
  "iPhone13,2/1-9": "Blue",
  "iPhone13,2/1-18": "Green",
  "iPhone13,2/1-17": "Purple",
  "iPhone13,2/1-6": "Red",
  
  // iPhone 13 Pro & 13 Pro Max
  "iPhone14,2/1-2": "Silver",
  "iPhone14,2/1-3": "Gold",
  "iPhone14,2/1-9": "Sierra Blue",
  "iPhone14,2/1-1": "Graphite",
  "iPhone14,2/1-18": "Alpine Green",
  "iPhone14,3/1-2": "Silver",
  "iPhone14,3/1-3": "Gold",
  "iPhone14,3/1-9": "Sierra Blue",
  "iPhone14,3/1-1": "Graphite",
  "iPhone14,3/1-18": "Alpine Green",
  
  // iPhone 13 & 13 mini
  "iPhone14,4/1-2": "Starlight",
  "iPhone14,4/1-1": "Midnight",
  "iPhone14,4/1-9": "Blue",
  "iPhone14,4/1-4": "Pink",
  "iPhone14,4/1-6": "Red",
  "iPhone14,4/1-18": "Green",
  "iPhone14,5/1-2": "Starlight",
  "iPhone14,5/1-1": "Midnight",
  "iPhone14,5/1-9": "Blue",
  "iPhone14,5/1-4": "Pink",
  "iPhone14,5/1-6": "Red",
  "iPhone14,5/1-18": "Green",
  
  // iPhone 14 & 14 Plus
  "iPhone14,7/1-2": "Starlight",
  "iPhone14,7/1-1": "Midnight",
  "iPhone14,7/1-9": "Blue",
  "iPhone14,7/1-6": "Red",
  "iPhone14,7/1-17": "Purple",
  "iPhone14,7/1-7": "Yellow",
  "iPhone14,8/1-2": "Starlight",
  "iPhone14,8/1-1": "Midnight",
  "iPhone14,8/1-9": "Blue",
  "iPhone14,8/1-6": "Red",
  "iPhone14,8/1-17": "Purple",
  "iPhone14,8/1-7": "Yellow",
  
  // iPhone 14 Pro & 14 Pro Max
  "iPhone15,2/1-2": "Silver",
  "iPhone15,2/1-1": "Space Black",
  "iPhone15,2/1-3": "Gold",
  "iPhone15,2/1-17": "Deep Purple",
  "iPhone15,3/1-2": "Silver",
  "iPhone15,3/1-1": "Space Black",
  "iPhone15,3/1-3": "Gold",
  "iPhone15,3/1-17": "Deep Purple",
  
  // iPhone 15 & 15 Plus
  "iPhone15,4/1-1": "Black",
  "iPhone15,4/1-9": "Blue",
  "iPhone15,4/1-4": "Pink",
  "iPhone15,4/1-7": "Yellow",
  "iPhone15,4/1-18": "Green",
  "iPhone15,5/1-1": "Black",
  "iPhone15,5/1-9": "Blue",
  "iPhone15,5/1-4": "Pink",
  "iPhone15,5/1-7": "Yellow",
  "iPhone15,5/1-18": "Green",
  
  // iPhone 15 Pro & 15 Pro Max
  "iPhone16,1/1-5": "Natural Titanium",
  "iPhone16,1/1-9": "Blue Titanium",
  "iPhone16,1/1-2": "White Titanium",
  "iPhone16,1/1-1": "Black Titanium",
  "iPhone16,2/1-5": "Natural Titanium",
  "iPhone16,2/1-9": "Blue Titanium",
  "iPhone16,2/1-2": "White Titanium",
  "iPhone16,2/1-1": "Black Titanium",
  
  // iPhone 16 & 16 Plus
  "iPhone17,1/1-5": "Natural Titanium",
  "iPhone17,1/1-4": "Desert Titanium",
  "iPhone17,1/1-2": "White Titanium",
  "iPhone17,1/1-1": "Black Titanium",
  "iPhone17,2/1-5": "Natural Titanium",
  "iPhone17,2/1-4": "Desert Titanium",
  "iPhone17,2/1-2": "White Titanium",
  "iPhone17,2/1-1": "Black Titanium",
  
  // iPhone 16 Pro & 16 Pro Max
  "iPhone17,3/1-4": "Pink",
  "iPhone17,3/1-18": "Teal",
  "iPhone17,3/1-9": "Ultramarine",
  "iPhone17,3/1-2": "White",
  "iPhone17,3/1-1": "Black",
  "iPhone17,4/1-4": "Pink",
  "iPhone17,4/1-18": "Teal",
  "iPhone17,4/1-9": "Ultramarine",
  "iPhone17,4/1-2": "White",
  "iPhone17,4/1-1": "Black",
  
  // iPhone 16 Air
  "iPhone17,5/1-2": "White",
  "iPhone17,5/1-1": "Black",
  
  // iPhone 17 Pro & 17 Pro Max
  "iPhone18,1/1-2": "Silver",
  "iPhone18,1/1-8": "Cosmic Orange",
  "iPhone18,1/1-9": "Deep Blue",
  "iPhone18,2/1-2": "Silver",
  "iPhone18,2/1-8": "Cosmic Orange",
  "iPhone18,2/1-9": "Deep Blue",
  
  // iPhone 17 & 17 Plus
  "iPhone18,3/1-1": "Black",
  "iPhone18,3/1-2": "White",
  "iPhone18,3/1-9": "Misty Blue",
  "iPhone18,3/1-17": "Lavender Purple",
  "iPhone18,3/1-18": "Sage Green",
  
  // iPhone 17 Air
  "iPhone18,4/1-1": "Space Black",
  "iPhone18,4/1-2": "Cloud White",
  "iPhone18,4/1-3": "Light Gold",
  "iPhone18,4/1-9": "Sky Blue",
};

// Color mapping data (Chinese)
export const deviceColorMapZh: Record<string, string> = {
  // iPod touch 4th generation
  "iPod4,1/black-black": "银色",
  "iPod4,1/white-black": "银色",
  
  // iPod touch 5th generation
  "iPod5,1/black-black": "黑色",
  "iPod5,1/black-silver": "银色",
  "iPod5,1/white-silver": "银色",
  "iPod5,1/white-sparrow": "深空灰",
  "iPod5,1/white-blue": "蓝色",
  "iPod5,1/white-pink": "粉色",
  "iPod5,1/white-red": "红色",
  "iPod5,1/white-yellow": "黄色",
  
  // iPod touch 7th generation
  "iPod7,1/#3b3b3c-#6b6a6d": "深空灰",
  "iPod7,1/#e1e4e3-#dadcdb": "银色",
  "iPod7,1/#e1e4e3-#e1ccb7": "金色",
  "iPod7,1/#e1e4e3-#c6353f": "红色",
  "iPod7,1/#e1e4e3-#458dce": "蓝色",
  "iPod7,1/#e1e4e3-#e75090": "粉色",
  
  // iPod touch 9th generation
  "iPod9,1/2-2": "银色",
  "iPod9,1/2-3": "金色",
  "iPod9,1/2-4": "粉色",
  "iPod9,1/2-5": "深空灰",
  "iPod9,1/2-6": "红色",
  "iPod9,1/2-9": "蓝色",
  
  // iPad 1st generation
  "iPad1,1/black-silver": "银色",
  
  // iPad 2
  "iPad2,1/black-silver": "银色",
  "iPad2,1/white-silver": "银色",
  "iPad2,2/black-silver": "银色",
  "iPad2,2/white-silver": "银色",
  "iPad2,3/black-silver": "银色",
  "iPad2,3/white-silver": "银色",
  "iPad2,4/black-silver": "银色",
  "iPad2,4/white-silver": "银色",
  "iPad2,5/black-slate": "碳黑色",
  "iPad2,5/white-silver": "银色",
  "iPad2,6/black-slate": "碳黑色",
  "iPad2,6/white-silver": "银色",
  "iPad2,7/black-slate": "碳黑色",
  "iPad2,7/white-silver": "银色",
  
  // iPad 3rd generation
  "iPad3,1/black-silver": "银色",
  "iPad3,1/white-silver": "银色",
  "iPad3,2/black-silver": "银色",
  "iPad3,2/white-silver": "银色",
  "iPad3,3/black-silver": "银色",
  "iPad3,3/white-silver": "银色",
  "iPad3,4/black-silver": "银色",
  "iPad3,4/white-silver": "银色",
  "iPad3,5/black-silver": "银色",
  "iPad3,5/white-silver": "银色",
  "iPad3,6/black-silver": "银色",
  "iPad3,6/white-silver": "银色",
  
  // iPad 4th generation & iPad mini series
  "iPad4,1/#e1e4e3-#d7d9d8": "银色",
  "iPad4,1/#3b3b3c-#99989b": "深空灰",
  "iPad4,2/#e1e4e3-#d7d9d8": "银色",
  "iPad4,2/#3b3b3c-#99989b": "深空灰",
  "iPad4,3/#e1e4e3-#d7d9d8": "银色",
  "iPad4,3/#3b3b3c-#99989b": "深空灰",
  "iPad4,4/#e1e4e3-#d7d9d8": "银色",
  "iPad4,4/#3b3b3c-#99989b": "深空灰",
  "iPad4,5/#e1e4e3-#d7d9d8": "银色",
  "iPad4,5/#3b3b3c-#99989b": "深空灰",
  "iPad4,6/#e1e4e3-#d7d9d8": "银色",
  "iPad4,6/#3b3b3c-#99989b": "深空灰",
  "iPad4,7/#e1e4e3-#e1ccb5": "金色",
  "iPad4,7/#e1e4e3-#d7d9d8": "银色",
  "iPad4,7/#3b3b3c-#b4b5b9": "深空灰",
  "iPad4,8/#e1e4e3-#e1ccb5": "金色",
  "iPad4,8/#e1e4e3-#d7d9d8": "银色",
  "iPad4,8/#3b3b3c-#b4b5b9": "深空灰",
  "iPad4,9/#e1e4e3-#e1ccb5": "金色",
  "iPad4,9/#e1e4e3-#d7d9d8": "银色",
  "iPad4,9/#3b3b3c-#b4b5b9": "深空灰",
  
  // iPad Air & iPad Air 2
  "iPad5,1/#e1e4e3-#e1ccb5": "金色",
  "iPad5,1/#e1e4e3-#d7d9d8": "银色",
  "iPad5,1/#3b3b3c-#b4b5b9": "深空灰",
  "iPad5,2/#e1e4e3-#e1ccb5": "金色",
  "iPad5,2/#e1e4e3-#d7d9d8": "银色",
  "iPad5,2/#3b3b3c-#b4b5b9": "深空灰",
  "iPad5,3/#e1e4e3-#e1ccb5": "金色",
  "iPad5,3/#e1e4e3-#d7d9d8": "银色",
  "iPad5,3/#3b3b3c-#b4b5b9": "深空灰",
  "iPad5,4/#e1e4e3-#e1ccb5": "金色",
  "iPad5,4/#e1e4e3-#d7d9d8": "银色",
  "iPad5,4/#3b3b3c-#b4b5b9": "深空灰",
  
  // iPad mini 4 & iPad (5th gen)
  "iPad6,11/2-3": "金色",
  "iPad6,11/2-2": "银色",
  "iPad6,11/1-1": "深空灰",
  "iPad6,12/2-3": "金色",
  "iPad6,12/2-2": "银色",
  "iPad6,12/1-1": "深空灰",
  
  // iPad Pro 9.7
  "iPad6,3/#e4e7e8-#e4c1b9": "玫瑰金",
  "iPad6,3/#272728-#b9b7ba": "深空灰",
  "iPad6,3/#e4e7e8-#e1ccb7": "金色",
  "iPad6,3/#e4e7e8-#dadcdb": "银色",
  "iPad6,4/#e4e7e8-#e4c1b9": "玫瑰金",
  "iPad6,4/#272728-#b9b7ba": "深空灰",
  "iPad6,4/#e4e7e8-#e1ccb7": "金色",
  "iPad6,4/#e4e7e8-#dadcdb": "银色",
  
  // iPad Pro 12.9 (1st & 2nd gen)
  "iPad6,7/#3b3b3c-#b4b5b9": "深空灰",
  "iPad6,7/#e1e4e3-#e1ccb5": "金色",
  "iPad6,7/#e1e4e3-#d7d9d8": "银色",
  "iPad6,8/#3b3b3c-#b4b5b9": "深空灰",
  "iPad6,8/#e1e4e3-#e1ccb5": "金色",
  "iPad6,8/#e1e4e3-#d7d9d8": "银色",
  
  // iPad Pro 10.5
  "iPad7,1/#3b3b3c-#b4b5b9": "深空灰",
  "iPad7,1/#e1e4e3-#e1ccb5": "金色",
  "iPad7,1/#e1e4e3-#d7d9d8": "银色",
  "iPad7,2/#3b3b3c-#b4b5b9": "深空灰",
  "iPad7,2/#e1e4e3-#e1ccb5": "金色",
  "iPad7,2/#e1e4e3-#d7d9d8": "银色",
  
  // iPad Pro 10.5 & iPad (6th-7th gen)
  "iPad7,3/2-4": "玫瑰金",
  "iPad7,3/1-1": "深空灰",
  "iPad7,3/2-3": "金色",
  "iPad7,3/2-2": "银色",
  "iPad7,4/2-4": "玫瑰金",
  "iPad7,4/1-1": "深空灰",
  "iPad7,4/2-3": "金色",
  "iPad7,4/2-2": "银色",
  "iPad7,5/1-1": "深空灰",
  "iPad7,5/2-3": "金色",
  "iPad7,5/2-2": "银色",
  "iPad7,6/1-1": "深空灰",
  "iPad7,6/2-3": "金色",
  "iPad7,6/2-2": "银色",
  "iPad7,11/1-1": "深空灰",
  "iPad7,11/2-3": "金色",
  "iPad7,11/2-2": "银色",
  "iPad7,12/1-1": "深空灰",
  "iPad7,12/2-3": "金色",
  "iPad7,12/2-2": "银色",
  
  // iPad (8th & 9th gen)
  "iPad11,6/1-1": "深空灰",
  "iPad11,6/2-3": "金色",
  "iPad11,6/2-2": "银色",
  "iPad11,7/1-1": "深空灰",
  "iPad11,7/2-3": "金色",
  "iPad11,7/2-2": "银色",
  "iPad12,1/1-1": "深空灰",
  "iPad12,1/2-3": "金色",
  "iPad12,1/2-2": "银色",
  "iPad12,2/1-1": "深空灰",
  "iPad12,2/2-3": "金色",
  "iPad12,2/2-2": "银色",
  
  // iPad Pro 11 (1st-3rd gen) & iPad Pro 12.9 (3rd-5th gen)
  "iPad8,1/1-1": "深空灰",
  "iPad8,1/1-2": "银色",
  "iPad8,2/1-1": "深空灰",
  "iPad8,2/1-2": "银色",
  "iPad8,3/1-1": "深空灰",
  "iPad8,3/1-2": "银色",
  "iPad8,4/1-1": "深空灰",
  "iPad8,4/1-2": "银色",
  "iPad8,5/1-1": "深空灰",
  "iPad8,5/1-2": "银色",
  "iPad8,6/1-1": "深空灰",
  "iPad8,6/1-2": "银色",
  "iPad8,7/1-1": "深空灰",
  "iPad8,7/1-2": "银色",
  "iPad8,8/1-1": "深空灰",
  "iPad8,8/1-2": "银色",
  "iPad8,9/1-1": "深空灰",
  "iPad8,9/1-2": "银色",
  "iPad8,10/1-1": "深空灰",
  "iPad8,10/1-2": "银色",
  "iPad8,11/1-1": "深空灰",
  "iPad8,11/1-2": "银色",
  "iPad8,12/1-1": "深空灰",
  "iPad8,12/1-2": "银色",
  "iPad13,4/1-1": "深空灰",
  "iPad13,4/1-2": "银色",
  "iPad13,5/1-1": "深空灰",
  "iPad13,5/1-2": "银色",
  "iPad13,6/1-1": "深空灰",
  "iPad13,6/1-2": "银色",
  "iPad13,7/1-1": "深空灰",
  "iPad13,7/1-2": "银色",
  "iPad13,8/1-1": "深空灰",
  "iPad13,8/1-2": "银色",
  "iPad13,9/1-1": "深空灰",
  "iPad13,9/1-2": "银色",
  "iPad13,10/1-1": "深空灰",
  "iPad13,10/1-2": "银色",
  "iPad13,11/1-1": "深空灰",
  "iPad13,11/1-2": "银色",
  "iPad14,3/1-1": "深空灰",
  "iPad14,3/1-2": "银色",
  "iPad14,4/1-1": "深空灰",
  "iPad14,4/1-2": "银色",
  "iPad14,5/1-1": "深空灰",
  "iPad14,5/1-2": "银色",
  "iPad14,6/1-1": "深空灰",
  "iPad14,6/1-2": "银色",
  
  // iPad (10th gen)
  "iPad13,18/1-3": "黄色",
  "iPad13,18/1-4": "粉色",
  "iPad13,18/1-1": "银色",
  "iPad13,18/1-2": "蓝色",
  "iPad13,19/1-3": "黄色",
  "iPad13,19/1-4": "粉色",
  "iPad13,19/1-1": "银色",
  "iPad13,19/1-2": "蓝色",
  
  // iPad (11th gen)
  "iPad15,7/1-3": "黄色",
  "iPad15,7/1-4": "粉色",
  "iPad15,7/1-1": "银色",
  "iPad15,7/1-2": "蓝色",
  "iPad15,8/1-3": "黄色",
  "iPad15,8/1-4": "粉色",
  "iPad15,8/1-1": "银色",
  "iPad15,8/1-2": "蓝色",
  
  // iPad mini (5th gen)
  "iPad11,1/2-3": "金色",
  "iPad11,1/2-2": "银色",
  "iPad11,1/1-1": "深空灰",
  "iPad11,2/2-3": "金色",
  "iPad11,2/2-2": "银色",
  "iPad11,2/1-1": "深空灰",
  "iPad11,3/2-3": "金色",
  "iPad11,3/2-2": "银色",
  "iPad11,3/1-1": "深空灰",
  "iPad11,4/2-3": "金色",
  "iPad11,4/2-2": "银色",
  "iPad11,4/1-1": "深空灰",
  
  // iPad mini (6th gen)
  "iPad13,1/1-1": "深空灰",
  "iPad13,1/1-2": "银色",
  "iPad13,1/1-18": "绿色",
  "iPad13,1/1-3": "玫瑰金",
  "iPad13,1/1-4": "天蓝色",
  "iPad13,2/1-1": "深空灰",
  "iPad13,2/1-2": "银色",
  "iPad13,2/1-18": "绿色",
  "iPad13,2/1-3": "玫瑰金",
  "iPad13,2/1-4": "天蓝色",
  
  // iPad Air (4th & 5th gen)
  "iPad13,16/1-1": "深空黑",
  "iPad13,16/1-4": "蓝色",
  "iPad13,16/1-6": "星光色",
  "iPad13,16/1-7": "紫色",
  "iPad13,16/1-3": "粉色",
  "iPad13,17/1-1": "深空黑",
  "iPad13,17/1-4": "蓝色",
  "iPad13,17/1-6": "星光色",
  "iPad13,17/1-7": "紫色",
  "iPad13,17/1-3": "粉色",
  "iPad14,8/1-1": "深空灰",
  "iPad14,8/1-4": "蓝色",
  "iPad14,8/1-6": "星光色",
  "iPad14,8/1-7": "紫色",
  "iPad14,9/1-1": "深空灰",
  "iPad14,9/1-4": "蓝色",
  "iPad14,9/1-6": "星光色",
  "iPad14,9/1-7": "紫色",
  "iPad15,3/1-1": "深空灰",
  "iPad15,3/1-4": "蓝色",
  "iPad15,3/1-6": "星光色",
  "iPad15,3/1-7": "紫色",
  "iPad15,4/1-1": "深空灰",
  "iPad15,4/1-4": "蓝色",
  "iPad15,4/1-6": "星光色",
  "iPad15,4/1-7": "紫色",
  "iPad14,10/1-1": "深空灰",
  "iPad14,10/1-4": "蓝色",
  "iPad14,10/1-6": "星光色",
  "iPad14,10/1-7": "紫色",
  "iPad14,11/1-1": "深空灰",
  "iPad14,11/1-4": "蓝色",
  "iPad14,11/1-6": "星光色",
  "iPad14,11/1-7": "紫色",
  "iPad15,5/1-1": "深空灰",
  "iPad15,5/1-4": "蓝色",
  "iPad15,5/1-6": "星光色",
  "iPad15,5/1-7": "紫色",
  "iPad15,6/1-1": "深空灰",
  "iPad15,6/1-4": "蓝色",
  "iPad15,6/1-6": "星光色",
  "iPad15,6/1-7": "紫色",
  
  // iPad Air (M2 & later)
  "iPad14,1/1-3": "粉色",
  "iPad14,1/1-1": "深空灰",
  "iPad14,1/1-6": "星光色",
  "iPad14,1/1-7": "紫色",
  "iPad14,1/1-4": "蓝色",
  "iPad14,2/1-3": "粉色",
  "iPad14,2/1-1": "深空灰",
  "iPad14,2/1-6": "星光色",
  "iPad14,2/1-7": "紫色",
  "iPad14,2/1-4": "蓝色",
  "iPad16,1/1-3": "粉色",
  "iPad16,1/1-1": "深空灰",
  "iPad16,1/1-6": "星光色",
  "iPad16,1/1-7": "紫色",
  "iPad16,1/1-4": "蓝色",
  "iPad16,2/1-3": "粉色",
  "iPad16,2/1-1": "深空灰",
  "iPad16,2/1-6": "星光色",
  "iPad16,2/1-7": "紫色",
  "iPad16,2/1-4": "蓝色",
  
  // iPad Pro (M2)
  "iPad16,3/1-1": "深空黑",
  "iPad16,3/1-2": "银色",
  "iPad16,4/1-1": "深空黑",
  "iPad16,4/1-2": "银色",
  "iPad16,5/1-1": "深空黑",
  "iPad16,5/1-2": "银色",
  "iPad16,6/1-1": "深空黑",
  "iPad16,6/1-2": "银色",
  
  // iPhone 3G & 3GS
  "iPhone1,2/black-black": "黑色",
  "iPhone1,2/white-white": "白色",
  "iPhone2,1/black-black": "黑色",
  "iPhone2,1/white-white": "白色",
  
  // iPhone 4 & 4S
  "iPhone3,1/black-black": "黑色",
  "iPhone3,1/white-white": "白色",
  "iPhone3,2/black-black": "黑色",
  "iPhone3,2/white-white": "白色",
  "iPhone3,3/black-black": "黑色",
  "iPhone3,3/white-white": "白色",
  "iPhone4,1/black-black": "黑色",
  "iPhone4,1/white-white": "白色",
  
  // iPhone 5 & 5S
  "iPhone5,1/black-slate": "碳黑色",
  "iPhone5,1/white-silver": "银色",
  "iPhone5,1/#e1e4e3-#d7d9d8": "银色",
  "iPhone5,1/#3b3b3c-#99989b": "碳黑色",
  "iPhone5,2/black-slate": "碳黑色",
  "iPhone5,2/white-silver": "银色",
  "iPhone5,2/#e1e4e3-#d7d9d8": "银色",
  "iPhone5,2/#3b3b3c-#99989b": "碳黑色",
  
  // iPhone 5C
  "iPhone5,3/#3b3b3c-#faf189": "黄色",
  "iPhone5,3/#3b3b3c-#f5f4f7": "白色",
  "iPhone5,3/#3b3b3c-#fe767a": "粉色",
  "iPhone5,3/#3b3b3c-#a1e877": "绿色",
  "iPhone5,3/#3b3b3c-#46abe0": "蓝色",
  "iPhone5,4/#3b3b3c-#faf189": "黄色",
  "iPhone5,4/#3b3b3c-#f5f4f7": "白色",
  "iPhone5,4/#3b3b3c-#fe767a": "粉色",
  "iPhone5,4/#3b3b3c-#a1e877": "绿色",
  "iPhone5,4/#3b3b3c-#46abe0": "蓝色",
  
  // iPhone 5S
  "iPhone6,1/#e1e4e3-#d4c5b3": "金色",
  "iPhone6,1/#3b3b3c-#99989b": "深空灰",
  "iPhone6,1/#e1e4e3-#d7d9d8": "银色",
  "iPhone6,2/#e1e4e3-#d4c5b3": "金色",
  "iPhone6,2/#3b3b3c-#99989b": "深空灰",
  "iPhone6,2/#e1e4e3-#d7d9d8": "银色",
  
  // iPhone 6 & 6 Plus
  "iPhone7,1/#e1e4e3-#e1ccb5": "金色",
  "iPhone7,1/#3b3b3c-#b4b5b9": "深空灰",
  "iPhone7,1/#e1e4e3-#d7d9d8": "银色",
  "iPhone7,2/#e1e4e3-#e1ccb5": "金色",
  "iPhone7,2/#3b3b3c-#b4b5b9": "深空灰",
  "iPhone7,2/#e1e4e3-#d7d9d8": "银色",
  
  // iPhone 6S & 6S Plus
  "iPhone8,1/#e4e7e8-#e1ccb7": "金色",
  "iPhone8,1/#e4e7e8-#e1ccb5": "金色",
  "iPhone8,1/#e4e7e8-#e4c1b9": "玫瑰金",
  "iPhone8,1/2-4": "玫瑰金",
  "iPhone8,1/#272728-#b9b7ba": "深空灰",
  "iPhone8,1/1-1": "深空灰",
  "iPhone8,1/#e1e4e3-#dadcdb": "银色",
  "iPhone8,2/#e4e7e8-#e1ccb7": "金色",
  "iPhone8,2/#e4e7e8-#e1ccb5": "金色",
  "iPhone8,2/#e4e7e8-#e4c1b9": "玫瑰金",
  "iPhone8,2/2-4": "玫瑰金",
  "iPhone8,2/#272728-#b9b7ba": "深空灰",
  "iPhone8,2/1-1": "深空灰",
  "iPhone8,2/#e1e4e3-#dadcdb": "银色",
  
  // iPhone SE (1st gen)
  "iPhone8,4/#c8caca-#e5bdb5": "玫瑰金",
  "iPhone8,4/#c8caca-#d6c8b9": "金色",
  "iPhone8,4/#121211-#aeb1b8": "深空灰",
  "iPhone8,4/#c8caca-#dcdede": "银色",
  
  // iPhone 7 & 7 Plus
  "iPhone9,1/1-1": "黑色",
  "iPhone9,1/2-4": "玫瑰金",
  "iPhone9,1/2-3": "金色",
  "iPhone9,1/1-5": "亮黑色",
  "iPhone9,1/2-2": "银色",
  "iPhone9,1/2-6": "红色",
  "iPhone9,2/1-1": "黑色",
  "iPhone9,2/2-4": "玫瑰金",
  "iPhone9,2/2-3": "金色",
  "iPhone9,2/1-5": "亮黑色",
  "iPhone9,2/2-2": "银色",
  "iPhone9,2/2-6": "红色",
  "iPhone9,3/1-1": "黑色",
  "iPhone9,3/2-4": "玫瑰金",
  "iPhone9,3/2-3": "金色",
  "iPhone9,3/1-5": "亮黑色",
  "iPhone9,3/2-2": "银色",
  "iPhone9,3/2-6": "红色",
  "iPhone9,4/1-1": "黑色",
  "iPhone9,4/2-4": "玫瑰金",
  "iPhone9,4/2-3": "金色",
  "iPhone9,4/1-5": "亮黑色",
  "iPhone9,4/2-2": "银色",
  "iPhone9,4/2-6": "红色",
  
  // iPhone 8 & 8 Plus
  "iPhone10,1/1-8": "深空灰",
  "iPhone10,1/1-1": "深空灰",
  "iPhone10,1/2-7": "金色",
  "iPhone10,1/2-3": "金色",
  "iPhone10,1/2-2": "银色",
  "iPhone10,1/1-6": "红色",
  "iPhone10,2/1-8": "深空灰",
  "iPhone10,2/1-1": "深空灰",
  "iPhone10,2/2-7": "金色",
  "iPhone10,2/2-3": "金色",
  "iPhone10,2/2-2": "银色",
  "iPhone10,2/1-6": "红色",
  "iPhone10,4/1-8": "深空灰",
  "iPhone10,4/1-1": "深空灰",
  "iPhone10,4/2-7": "金色",
  "iPhone10,4/2-3": "金色",
  "iPhone10,4/2-2": "银色",
  "iPhone10,4/1-6": "红色",
  "iPhone10,5/1-8": "深空灰",
  "iPhone10,5/1-1": "深空灰",
  "iPhone10,5/2-7": "金色",
  "iPhone10,5/2-3": "金色",
  "iPhone10,5/2-2": "银色",
  "iPhone10,5/1-6": "红色",
  
  // iPhone X
  "iPhone10,3/1-1": "深空灰",
  "iPhone10,3/1-2": "银色",
  "iPhone10,6/1-1": "深空灰",
  "iPhone10,6/1-2": "银色",
  
  // iPhone XS & XS Max
  "iPhone11,2/1-1": "深空灰",
  "iPhone11,2/1-2": "银色",
  "iPhone11,2/1-4": "金色",
  "iPhone11,4/1-1": "深空灰",
  "iPhone11,4/1-2": "银色",
  "iPhone11,4/1-4": "金色",
  "iPhone11,6/1-1": "深空灰",
  "iPhone11,6/1-2": "银色",
  "iPhone11,6/1-4": "金色",
  
  // iPhone XR
  "iPhone11,8/1-1": "黑色",
  "iPhone11,8/1-2": "白色",
  "iPhone11,8/1-7": "黄色",
  "iPhone11,8/1-8": "珊瑚色",
  "iPhone11,8/1-9": "蓝色",
  "iPhone11,8/1-6": "红色",
  
  // iPhone 11
  "iPhone12,1/1-1": "黑色",
  "iPhone12,1/1-2": "白色",
  "iPhone12,1/1-6": "红色",
  "iPhone12,1/1-7": "黄色",
  "iPhone12,1/1-17": "紫色",
  "iPhone12,1/1-18": "绿色",
  
  // iPhone 11 Pro & 11 Pro Max
  "iPhone12,3/1-1": "深空灰",
  "iPhone12,3/1-2": "银色",
  "iPhone12,3/1-4": "金色",
  "iPhone12,3/1-18": "暗夜绿",
  "iPhone12,5/1-1": "深空灰",
  "iPhone12,5/1-2": "银色",
  "iPhone12,5/1-4": "金色",
  "iPhone12,5/1-18": "暗夜绿",
  
  // iPhone SE (2nd gen)
  "iPhone12,8/1-1": "黑色",
  "iPhone12,8/1-2": "白色",
  "iPhone12,8/1-6": "红色",
  
  // iPhone SE (3rd gen)
  "iPhone14,6/1-1": "午夜色",
  "iPhone14,6/1-2": "星光色",
  "iPhone14,6/1-6": "红色",
  
  // iPhone 12 Pro & 12 Pro Max
  "iPhone13,3/1-2": "银色",
  "iPhone13,3/1-3": "金色",
  "iPhone13,3/1-9": "海蓝色",
  "iPhone13,3/1-1": "石墨色",
  "iPhone13,4/1-2": "银色",
  "iPhone13,4/1-3": "金色",
  "iPhone13,4/1-9": "海蓝色",
  "iPhone13,4/1-1": "石墨色",
  
  // iPhone 12 & 12 mini
  "iPhone13,1/1-2": "白色",
  "iPhone13,1/1-1": "黑色",
  "iPhone13,1/1-9": "蓝色",
  "iPhone13,1/1-18": "绿色",
  "iPhone13,1/1-17": "紫色",
  "iPhone13,1/1-6": "红色",
  "iPhone13,2/1-2": "白色",
  "iPhone13,2/1-1": "黑色",
  "iPhone13,2/1-9": "蓝色",
  "iPhone13,2/1-18": "绿色",
  "iPhone13,2/1-17": "紫色",
  "iPhone13,2/1-6": "红色",
  
  // iPhone 13 Pro & 13 Pro Max
  "iPhone14,2/1-2": "银色",
  "iPhone14,2/1-3": "金色",
  "iPhone14,2/1-9": "远峰蓝",
  "iPhone14,2/1-1": "石墨色",
  "iPhone14,2/1-18": "苍岭绿",
  "iPhone14,3/1-2": "银色",
  "iPhone14,3/1-3": "金色",
  "iPhone14,3/1-9": "远峰蓝",
  "iPhone14,3/1-1": "石墨色",
  "iPhone14,3/1-18": "苍岭绿",
  
  // iPhone 13 & 13 mini
  "iPhone14,4/1-2": "星光色",
  "iPhone14,4/1-1": "午夜色",
  "iPhone14,4/1-9": "蓝色",
  "iPhone14,4/1-4": "粉色",
  "iPhone14,4/1-6": "红色",
  "iPhone14,4/1-18": "绿色",
  "iPhone14,5/1-2": "星光色",
  "iPhone14,5/1-1": "午夜色",
  "iPhone14,5/1-9": "蓝色",
  "iPhone14,5/1-4": "粉色",
  "iPhone14,5/1-6": "红色",
  "iPhone14,5/1-18": "绿色",
  
  // iPhone 14 & 14 Plus
  "iPhone14,7/1-2": "星光色",
  "iPhone14,7/1-1": "午夜色",
  "iPhone14,7/1-9": "蓝色",
  "iPhone14,7/1-6": "红色",
  "iPhone14,7/1-17": "紫色",
  "iPhone14,7/1-7": "黄色",
  "iPhone14,8/1-2": "星光色",
  "iPhone14,8/1-1": "午夜色",
  "iPhone14,8/1-9": "蓝色",
  "iPhone14,8/1-6": "红色",
  "iPhone14,8/1-17": "紫色",
  "iPhone14,8/1-7": "黄色",
  
  // iPhone 14 Pro & 14 Pro Max
  "iPhone15,2/1-2": "银色",
  "iPhone15,2/1-1": "深空黑",
  "iPhone15,2/1-3": "金色",
  "iPhone15,2/1-17": "暗紫色",
  "iPhone15,3/1-2": "银色",
  "iPhone15,3/1-1": "深空黑",
  "iPhone15,3/1-3": "金色",
  "iPhone15,3/1-17": "暗紫色",
  
  // iPhone 15 & 15 Plus
  "iPhone15,4/1-1": "黑色",
  "iPhone15,4/1-9": "蓝色",
  "iPhone15,4/1-4": "粉色",
  "iPhone15,4/1-7": "黄色",
  "iPhone15,4/1-18": "绿色",
  "iPhone15,5/1-1": "黑色",
  "iPhone15,5/1-9": "蓝色",
  "iPhone15,5/1-4": "粉色",
  "iPhone15,5/1-7": "黄色",
  "iPhone15,5/1-18": "绿色",
  
  // iPhone 15 Pro & 15 Pro Max
  "iPhone16,1/1-5": "原色",
  "iPhone16,1/1-9": "蓝色",
  "iPhone16,1/1-2": "白色",
  "iPhone16,1/1-1": "黑色",
  "iPhone16,2/1-5": "原色",
  "iPhone16,2/1-9": "蓝色",
  "iPhone16,2/1-2": "白色",
  "iPhone16,2/1-1": "黑色",
  
  // iPhone 16 & 16 Plus
  "iPhone17,1/1-5": "原色",
  "iPhone17,1/1-4": "沙漠色",
  "iPhone17,1/1-2": "白色",
  "iPhone17,1/1-1": "黑色",
  "iPhone17,2/1-5": "原色",
  "iPhone17,2/1-4": "沙漠色",
  "iPhone17,2/1-2": "白色",
  "iPhone17,2/1-1": "黑色",
  
  // iPhone 16 Pro & 16 Pro Max
  "iPhone17,3/1-4": "粉色",
  "iPhone17,3/1-18": "深青色",
  "iPhone17,3/1-9": "群青色",
  "iPhone17,3/1-2": "白色",
  "iPhone17,3/1-1": "黑色",
  "iPhone17,4/1-4": "粉色",
  "iPhone17,4/1-18": "深青色",
  "iPhone17,4/1-9": "群青色",
  "iPhone17,4/1-2": "白色",
  "iPhone17,4/1-1": "黑色",
  
  // iPhone 16 Air
  "iPhone17,5/1-2": "白色",
  "iPhone17,5/1-1": "黑色",
  
  // iPhone 17 Pro & 17 Pro Max
  "iPhone18,1/1-2": "银色",
  "iPhone18,1/1-8": "星宇橙色",
  "iPhone18,1/1-9": "深蓝色",
  "iPhone18,2/1-2": "银色",
  "iPhone18,2/1-8": "星宇橙色",
  "iPhone18,2/1-9": "深蓝色",
  
  // iPhone 17 & 17 Plus
  "iPhone18,3/1-1": "黑色",
  "iPhone18,3/1-2": "白色",
  "iPhone18,3/1-9": "青雾蓝色",
  "iPhone18,3/1-17": "薰衣草紫色",
  "iPhone18,3/1-18": "鼠尾草绿色",
  
  // iPhone 17 Air
  "iPhone18,4/1-1": "深空黑色",
  "iPhone18,4/1-2": "云白色",
  "iPhone18,4/1-3": "浅金色",
  "iPhone18,4/1-9": "天蓝色",
};

/**
 * Get localized color name for a device
 * @param productType Device product type (e.g., "iPhone14,5")
 * @param deviceColor Device color value
 * @param enclosureColor Device enclosure color value (defaults to "1" if empty)
 * @param language Optional language code ('en' or 'zh'), defaults to current i18n language
 * @returns Localized color name or null if no mapping found
 */
export function getDeviceColorName(
  productType: string,
  deviceColor?: string,
  enclosureColor?: string,
  language?: string
): string | null {
  if (!deviceColor) {
    return null;
  }

  const lang = language || i18n.language;
  const isZh = lang.startsWith('zh');
  const map = isZh ? deviceColorMapZh : deviceColorMapEn;

  // Default enclosureColor to "1" if empty
  const finalEnclosureColor = enclosureColor || "1";

  // Build the key in the format: ProductType/DeviceColor-EnclosureColor
  const key = `${productType}/${deviceColor}-${finalEnclosureColor}`;

  // Return mapped color name or null if not found
  return map[key] || null;
}

/**
 * Get device color display text
 * @param productType Device product type (e.g., "iPhone14,5")
 * @param deviceColor Device color value
 * @param enclosureColor Device enclosure color value (defaults to "1" if empty)
 * @param language Optional language code ('en' or 'zh'), defaults to current i18n language
 * @returns Display text for color, including localized "Unknown color (raw value)" if no mapping found
 */
export function getDeviceColorDisplay(
  productType: string,
  deviceColor?: string,
  enclosureColor?: string,
  language?: string
): string {
  if (!deviceColor) {
    const lang = language || i18n.language;
    const isZh = lang.startsWith('zh');
    return isZh ? "未知颜色" : "Unknown Color";
  }

  const colorName = getDeviceColorName(productType, deviceColor, enclosureColor, language);
  
  if (colorName) {
    return colorName;
  }

  // If no mapping found, show localized unknown color message with raw value
  const lang = language || i18n.language;
  const isZh = lang.startsWith('zh');
  const finalEnclosureColor = enclosureColor || "1";
  return isZh 
    ? `未知颜色 (${deviceColor}-${finalEnclosureColor})`
    : `Unknown Color (${deviceColor}-${finalEnclosureColor})`;
}

