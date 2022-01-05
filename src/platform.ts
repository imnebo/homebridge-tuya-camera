import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, TuyaCameraPlatformConfig, CountryUtil } from './settings';
import { TuyaCamera } from './devices/camera';
import axios from 'axios';
import Crypto from 'crypto-js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class TuyaCameraPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  version = require('../package.json').version; // eslint-disable-line @typescript-eslint/no-var-requires
  tokenInfo!: { access_token: string; refresh_token: string; uid: string; expire: number; };
  countryCode!: number;
  endpoint!: string;
  access_id: any;
  access_key: any;
  lang: any;
  username: any;
  password: any;
  appSchema: any;
  assetIDArr!: Array<any>;
  deviceArr!: Array<any>;
  devices: any;
  debugMode!: boolean;

  constructor(public readonly log: Logger, public readonly config: TuyaCameraPlatformConfig, public readonly api: API) {
    this.debug('Finished initializing platform:', this.config.name);
    // only load if configured
    if (!this.config) {
      return;
    }

    // HOOBS notice
    if (__dirname.includes('hoobs')) {
      this.log.warn('This plugin has not been tested under HOOBS, it is highly recommended that ' +
        'you switch to Homebridge: https://git.io/Jtxb0');
    }

    // verify the config
    try {
      this.verifyConfig();
      this.debug('Config OK');
    } catch (e: any) {
      this.log.error(JSON.stringify(e.message));
      this.debug(JSON.stringify(e));
      return;
    }

    //this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      try {
        this.discoverDevices();
      } catch (e: any) {
        this.log.error('Failed to Discover Devices.', JSON.stringify(e.message));
        this.debug(JSON.stringify(e));
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  verifyConfig() {
    if (!this.config.refreshRate) {
      // default 900 seconds (15 minutes)
      this.config.refreshRate! = 300;
      this.log.warn('Using Default Refresh Rate of 30 seconds.');
    }

    if (!this.config.username) {
      throw new Error('Missing Your Tuya Username(E-mail)');
    }
    if (!this.config.password) {
      throw new Error('Missing your Tuya Password');
    }
    if (!this.config.accessId) {
      throw new Error('Missing your Tuya Password');
    }
    if (!this.config.accessKey) {
      throw new Error('Missing your Tuya Password');
    }
  }


  async refreshAccessTokenIfNeed(path: string): Promise<void> {

    if (path.startsWith('/v1.0/iot-01/associated-users/actions/authorized-login')) {
      return;
    }

    if (this.tokenInfo.expire - 60 * 1000 > new Date().getTime()) {
      return;
    }

    this.tokenInfo.access_token = '';
    const md5pwd: any = Crypto.MD5(this.password).toString();
    const res: any = await this.post('/v1.0/iot-01/associated-users/actions/authorized-login', {
      'country_code': this.countryCode,
      'username': this.username,
      'password': md5pwd,
      'schema': this.appSchema,
    });
    const { access_token, refresh_token, uid, expire_time, platform_url } = res.result;
    this.endpoint = platform_url ? platform_url : this.endpoint;
    this.tokenInfo = {
      access_token: access_token,
      refresh_token: refresh_token,
      uid: uid,
      expire: expire_time * 1000 + new Date().getTime(),
    };

    return;
  }

  //Gets the list of devices under the associated user
  async getDevices() {
    this.countryCode = this.config.countryCode!;
    this.endpoint = (this.config.countryCode) ? new CountryUtil().getEndPointWithCountryCode(this.config.countryCode) : 'https://openapi.tuyaus.com';
    this.access_id = this.config.accessId;
    this.access_key = this.config.accessKey;
    this.lang = this.config.lang;
    this.username = this.config.username;
    this.password = this.config.password;

    this.appSchema = this.config.appSchema;

    this.assetIDArr = [];
    this.deviceArr = [];

    this.tokenInfo = {
      access_token: '',
      refresh_token: '',
      uid: '',
      expire: 0,
    };

    const res: any = await this.get('/v1.0/iot-01/associated-users/devices', { 'size': 100 });

    const tempIds: any = [];
    for (let i = 0; i < res.result.devices.length; i++) {
      tempIds.push(res.result.devices[i].id);
    }
    const deviceIds: any = this.refactoringIdsGroup(tempIds, 20);
    const devicesFunctions: any = [];
    for (const ids of deviceIds) {
      const functions = await this.getDevicesFunctions(ids);
      this.debug(JSON.stringify(functions));
      //devicesFunctions.push.spread(devicesFunctions, functions);
    }
    let devices: any = [];
    if (devicesFunctions) {
      for (let i = 0; i < res.result.devices.length; i++) {
        devices.push(Object.assign({}, res.result.devices[i], devicesFunctions.find((j) => j.devices[0] === res.result.devices[i].id)));
      }
    } else {
      devices = res.result.devices;
    }

    return devices;
  }

  refactoringIdsGroup(array: string | any[], subGroupLength: number) {
    let index: any = 0;
    const newArray: any = [];
    while (index < array.length) {
      newArray.push(array.slice(index, index += subGroupLength));
    }
    return newArray;
  }

  // single device gets the instruction set
  async getDeviceFunctions(deviceID: any) {
    const res = await this.get(`/v1.0/devices/${deviceID}/functions`);
    return res.result;
  }

  // Batch access to device instruction sets
  async getDevicesFunctions(devIds: any = []) {
    const res = await this.get('/v1.0/devices/functions', { 'device_ids': devIds.join(',') });
    return res.result;
  }

  // Get individual device details
  async getDeviceInfo(deviceID: any) {
    const res = await this.get(`/v1.0/devices/${deviceID}`);
    return res.result;
  }

  // Batch access to device details
  async getDeviceListInfo(devIds = []) {
    if (devIds.length === 0) {
      return [];
    }
    const res = await this.get('/v1.0/devices', { 'device_ids': devIds.join(',') });
    return res.result.list;
  }

  // Gets the individual device state
  async getDeviceStatus(deviceID: any) {
    const res = await this.get(`/v1.0/devices/${deviceID}/status`);
    return res.result;
  }

  // Remove the device based on the device ID
  async removeDevice(deviceID: any) {
    const res = await this.delete(`/v1.0/devices/${deviceID}`);
    return res.result;
  }

  // sendCommand
  async sendCommand(deviceID: any, params: any) {
    const res = await this.post(`/v1.0/devices/${deviceID}/commands`, params);
    return res.result;
  }

  // Gets the individual device state
  async getCameraRSTP(deviceID: any) {
    const cameraparams = {
      'type': 'rtsp',
    };
    const response = await this.post(`/v1.0/users/${this.tokenInfo.uid}/devices/${deviceID}/stream/actions/allocate`, cameraparams);
    return response.result.url;
  }

  // Gets the individual device state
  async getCameraHLS(deviceID: any) {
    const cameraparams = {
      'type': 'hls',
    };
    const response = await this.post(`/v1.0/users/${this.tokenInfo.uid}/devices/${deviceID}/stream/actions/allocate`, cameraparams);
    return response.result.url;
  }

  async request(method: string | any, path: string, params = null, body = null) {

    try {
      await this.refreshAccessTokenIfNeed(path);
    } catch (e: any) {
      this.log.error(e);
      this.log.error('Attention⚠️ ⚠️ ⚠️ ! You get an error!');
      this.log.error('Please confirm that the Access ID and Access Secret of the Smart Home PaaS project you are using were created after May 25, 2021.');
      this.log.error('Please linked devices by using Tuya Smart or Smart Life app in your cloud project.');
      return;
    }

    const now = new Date().getTime();
    const access_token = this.tokenInfo.access_token || '';
    const stringToSign = this.getStringToSign(method, path, params, body);
    const headers = {
      't': `${now}`,
      'client_id': this.access_id,
      'Signature-Headers': 'client_id',
      'sign': this.getSign(this.access_id, this.access_key, access_token, now, stringToSign),
      'sign_method': 'HMAC-SHA256',
      'access_token': access_token,
      'lang': this.lang,
      'dev_lang': 'javascript',
      'dev_channel': 'homebridge',
      'devVersion': '1.5.0',

    };
    this.debug(`TuyaOpenAPI request: method = ${method}, endpoint = ${this.endpoint}, path = ${path}, params = ${JSON.stringify(params)},`
      + ` body = ${JSON.stringify(body)}, headers = ${JSON.stringify(headers)}`);

    const res: any = await axios({
      baseURL: this.endpoint,
      url: path,
      method: method,
      headers: headers,
      params: params,
      data: body,
    });

    this.debug(`TuyaOpenAPI response: ${JSON.stringify(res.data)} path = ${path}`);
    return res.data;
  }

  async get(path, params?) {
    return this.request('get', path, params, null);
  }

  async post(path, params) {
    return this.request('post', path, null, params);
  }

  async delete(path, params?) {
    return this.request('delete', path, params, null);
  }

  getSign(access_id, access_key, access_token = '', timestamp = 0, stringToSign) {
    const message = access_id + access_token + `${timestamp}` + stringToSign;
    const hash = Crypto.HmacSHA256(message, access_key);
    const sign = hash.toString().toUpperCase();
    return sign;
  }

  getStringToSign(method, path, params, body) {
    const httpMethod: any = method.toUpperCase();
    let bodyStream: string | Crypto.lib.WordArray;
    if (body) {
      bodyStream = JSON.stringify(body);
    } else {
      bodyStream = '';
    }

    const contentSHA256: any = Crypto.SHA256(bodyStream);
    const headers: any = 'client_id' + ':' + this.access_id + '\n';
    const url: any = this.getSignUrl(path, params);
    const result: any = httpMethod + '\n' + contentSHA256 + '\n' + headers + '\n' + url;
    return result;
  }

  getSignUrl(path, obj) {
    if (!obj) {
      return path;
    } else {
      let i: string, url = '';
      for (i in obj) {
        url += '&' + i + '=' + obj[i];
      }
      return path + '?' + url.substr(1);
    }
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  async discoverDevices() {
    try {
      this.devices = await this.getDevices();
    } catch (e: any) {
      this.debug(JSON.stringify(e.message));
      this.log.error('Failed to get device information. Please check if the config.json is correct.');
      return;
    }

    for (const device of this.devices) {
      const deviceType = device.category;
      switch (deviceType) {
        case 'sp':
          this.log.info(`Discovered ${device.name}`);
          this.createCamera(device);
          break;
        default:
          this.log.info(`Discovered ${device.name}`);
          break;
      }
    }

  }

  private async createCamera(device) {
    const uuid = this.api.hap.uuid.generate(device.id);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!this.config.disablePlugin) {
        this.log.info(`Restoring existing accessory from cache: ${existingAccessory.displayName}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.displayName = device.name;
        existingAccessory.context.device = device;
        existingAccessory.context.serialNumber;
        existingAccessory.context.model = device.model;
        existingAccessory.context.firmwareRevision = this.version;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new TuyaCamera(this, existingAccessory, device);
        this.debug(`uuid: ${device.id}`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!this.config.disablePlugin) {
      // the accessory does not yet exist, so we need to create it
      this.log.info(`Adding new accessory: ${device.name}`);

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.name, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.displayName = device.name;
      accessory.context.device = device;
      accessory.context.serialNumber;
      accessory.context.model = device.model;
      accessory.context.firmwareRevision = this.version;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new TuyaCamera(this, accessory, device);
      this.debug(`uuid: ${device.id}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      if (this.config.debug === 'device') {
        this.log.error(`Unable to Register new device: ${device}`);
        this.log.error(`Check Config, Plugin Disabled: ${this.config.disablePlugin}`);
      }
    }
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.log.warn('Removing existing accessory from cache:', existingAccessory.displayName);
  }

  /**
   * If debug level logging is turned on, log to log.info
   * Otherwise send debug logs to log.debug
   * this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
   */
  debug(...log: any[]) {
    if (this.config.debug === 'debug') {
      this.log.info('[DEBUG]', String(...log));
    } else {
      this.log.debug(String(...log));
    }
  }

  /**
   * If device level logging is turned on, log to log.warn
   * Otherwise send debug logs to log.debug
   */
  device(...log: any[]) {
    if (this.config.debug === 'device') {
      this.log.warn('[DEVICE]', String(...log));
    } else if (this.config.debug === 'debug') {
      this.log.info('[DEBUG]', String(...log));
    } else {
      this.log.debug(String(...log));
    }
  }
}
