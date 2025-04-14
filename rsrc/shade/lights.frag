#version 330

#extension GL_EXT_texture_array : enable

const int MAX_POINT_LIGHTS = 10;
const int MAX_SPOT_LIGHTS = 10;
const int MAX_DIR_LIGHTS = 5;
const float SPECULAR_POWER = 10;
const int NUM_CASCADES = 6;
const int NUM_FACES = 6;
const float BIAS = 0.001;
const float SHADOW_FACTOR = 0;
const int FOG_QUALITY = 30;

in vec2 outTextCoord;
out vec4 fragColor;


struct Fog
{
    int activeFog;
    vec3 color;
    float density;
};
struct Attenuation
{
    float constant;
    float linear;
    float exponent;
};
struct AmbientLight
{
    float factor;
    vec3 color;
};
struct PointLight {
    vec3 position;
    vec3 color;
    float intensity;
    Attenuation att;
};
struct SpotLight
{
    PointLight pl;
    vec3 conedir;
    float cutoff;
};
struct DirLight
{
    vec3 color;
    vec3 direction;
    float intensity;
};
struct Shadow {
    mat4 projViewMatrix;
    float splitDistance;
};

uniform sampler2D albedoSampler;
uniform sampler2D normalSampler;
uniform sampler2D specularSampler;
uniform sampler2D depthSampler;
uniform sampler2DArray prspShadowMap;
uniform sampler2DArray dirShadowMap;

uniform mat4 invProjectionMatrix;
uniform mat4 invViewMatrix;

uniform AmbientLight ambientLight;
uniform Fog fog;
uniform PointLight pointLights[MAX_POINT_LIGHTS];
uniform SpotLight spotLights[MAX_SPOT_LIGHTS];
uniform DirLight dirLights[MAX_DIR_LIGHTS];
uniform Shadow shadows[NUM_CASCADES * MAX_DIR_LIGHTS + NUM_FACES * MAX_POINT_LIGHTS + MAX_SPOT_LIGHTS];

vec4 calcAmbient(AmbientLight ambientLight, vec4 ambient) {
    return vec4(ambientLight.factor * ambientLight.color, 1) * ambient;
}

vec4 calcLightColor(vec4 diffuse, vec4 specular, float reflectance, vec3 lightColor, float light_intensity, vec3 position, vec3 to_light_dir, vec3 normal) {
    vec4 diffuseColor = vec4(0, 0, 0, 1);
    vec4 specColor = vec4(0, 0, 0, 1);

    // Diffuse Light
    float diffuseFactor = max(dot(normal, to_light_dir), 0.0);
    diffuseColor = diffuse * vec4(lightColor, 1.0) * light_intensity * diffuseFactor;

    // Specular Light
    vec3 camera_direction = normalize(-position);
    vec3 from_light_dir = -to_light_dir;
    vec3 reflected_light = normalize(reflect(from_light_dir, normal));
    float specularFactor = max(dot(camera_direction, reflected_light), 0.0);
    specularFactor = pow(specularFactor, SPECULAR_POWER);
    specColor = specular * light_intensity  * specularFactor * reflectance * vec4(lightColor, 1.0);

    return (diffuseColor + specColor);
}

vec4 calcPointLight(vec4 diffuse, vec4 specular, float reflectance, PointLight light, vec3 position, vec3 normal) {
    vec3 light_direction = light.position - position;
    vec3 to_light_dir  = normalize(light_direction);
    vec4 light_color = calcLightColor(diffuse, specular, reflectance, light.color, light.intensity, position, to_light_dir, normal);

    // Apply Attenuation
    float distance = length(light_direction);
    float attenuationInv = light.att.constant + light.att.linear * distance +
    light.att.exponent * distance * distance;
    return light_color / attenuationInv;
}

vec4 calcPointLightFog(vec4 fog_color, PointLight light, vec3 position) {
    vec3 light_direction = light.position - position;
    vec3 to_light_dir  = normalize(light_direction);
    vec4 light_color = vec4(light.color,1) * fog_color * light.intensity;

    // Apply Attenuation
    float distance = length(light_direction);
    float attenuationInv = light.att.constant + light.att.linear * distance +
    light.att.exponent * distance * distance;
    return light_color / attenuationInv;
}

vec4 calcSpotLight(vec4 diffuse, vec4 specular, float reflectance, SpotLight light, vec3 position, vec3 normal) {
    vec3 light_direction = (invViewMatrix*vec4(light.pl.position,1) - invViewMatrix*vec4(position,1)).xyz;
    vec3 to_light_dir  = normalize(light_direction);
    vec3 from_light_dir  = -to_light_dir;
    float spot_alfa = dot(from_light_dir, normalize(light.conedir));

    vec4 color = vec4(0, 0, 0, 0);

    if (spot_alfa > light.cutoff)
    {
        color = calcPointLight(diffuse, specular, reflectance, light.pl, position, normal);
        color *= (1.0 - (1.0 - spot_alfa)/(1.0 - light.cutoff));
    }
    return color;
}

vec4 calcSpotLightFog(vec4 fog_color, SpotLight light, vec3 position) {
    vec3 light_direction = (invViewMatrix*vec4(light.pl.position,1) - invViewMatrix*vec4(position,1)).xyz;
    vec3 to_light_dir  = normalize(light_direction);
    vec3 from_light_dir  = -to_light_dir;
    float spot_alfa = dot(from_light_dir, normalize(light.conedir));

    vec4 color = vec4(0, 0, 0, 0);

    if (spot_alfa > light.cutoff)
    {
        color = calcPointLightFog(fog_color, light.pl, position);
        color *= (1.0 - (1.0 - spot_alfa)/(1.0 - light.cutoff));
    }
    return color;
}

vec4 calcDirLight(vec4 diffuse, vec4 specular, float reflectance, DirLight light, vec3 position, vec3 normal) {
    return calcLightColor(diffuse, specular, reflectance, light.color, light.intensity, position, normalize(light.direction), normal);
}

vec4 calcDirLightFog(vec4 fog_color, DirLight light) {
    return fog_color * vec4(light.color,1) * light.intensity;
}

vec4 calcFog(vec3 pos, vec4 color, Fog fog, vec3 ambientLight) {
    vec3 fogColor = fog.color * ambientLight;
    float distance = length(pos);
    float fogFactor = 1.0 / exp(distance * fog.density);
    fogFactor = clamp(fogFactor, 0.0, 1.0);

    vec3 resultColor = mix(fogColor, color.xyz, fogFactor);
    return vec4(resultColor.xyz, color.w);
}

float textureProj(vec4 shadowCoord, vec2 offset, int idx) {
    float shadow = 0.0;

    if (shadowCoord.z > -1.0 && shadowCoord.z < 1.0) {
        float dist = 0.0;
        dist = texture2DArray(prspShadowMap, vec3(shadowCoord.xy + offset, idx)).r;
        if (dist > shadowCoord.z - BIAS) {
            shadow = 1.0;
        }
    }
    return shadow;
}

float dirTextureProj(vec4 shadowCoord, vec2 offset, int idx) {
    float shadow = 0.0;

    if (shadowCoord.z > -1.0 && shadowCoord.z < 1.0) {
        float dist = 0.0;
        dist = texture2DArray(dirShadowMap, vec3(shadowCoord.xy + offset, idx)).r;
        if (dist > shadowCoord.z - BIAS) {
            shadow = 1.0;
        }
    }
    return shadow;
}

float calcDirShadow(vec4 worldPosition, int idx, int idx2) {
    float shadow = 0.0;
    vec4 shadowMapPosition = shadows[idx2].projViewMatrix * worldPosition;
    vec4 shadowCoord = (shadowMapPosition / shadowMapPosition.w) * 0.5 + 0.5;
    shadow = dirTextureProj(shadowCoord, vec2(0, 0), idx);
    return shadow;
}

float calcShadow(vec4 worldPosition, int idx) {
    float shadow = 0.0;
    vec4 shadowMapPosition = shadows[idx].projViewMatrix * worldPosition;
    vec4 shadowCoord = (shadowMapPosition / shadowMapPosition.w) * 0.5 + 0.5;
    shadow = textureProj(shadowCoord, vec2(0, 0), idx);
    return shadow;
}

float calcCubeShadow(vec4 worldPosition, vec3 position, int idx){
    float shadow = 0.0;
    float dist = 0.0;
    for(int i = 0; i < NUM_FACES; i++){
        vec4 shadowMapPosition = shadows[idx + i].projViewMatrix * worldPosition;
        vec4 coord = shadowMapPosition / abs(shadowMapPosition.w);
        if (max(abs(coord.x),abs(coord.y)) < 1 && coord.z > 0) {
            shadow = calcShadow(worldPosition, idx + i);
        }
    }
    return shadow;
}

void main()
{
    vec4 albedoSamplerValue = texture(albedoSampler, outTextCoord);
    vec3 albedo  = albedoSamplerValue.rgb;
    vec4 diffuse = vec4(albedo, 1);

    float reflectance = albedoSamplerValue.a;
    vec3 normal = normalize(2.0 * texture(normalSampler, outTextCoord).rgb  - 1.0);
    vec4 specular = texture(specularSampler, outTextCoord);

    // Retrieve position from depth
    float depth = texture(depthSampler, outTextCoord).x * 2.0 - 1.0;
    vec4 clip      = vec4(outTextCoord.x * 2.0 - 1.0, outTextCoord.y * 2.0 - 1.0, depth, 1.0);
    vec4 view_w    = invProjectionMatrix * clip;
    vec3 view_pos  = view_w.xyz / view_w.w;

    int index = 0;

    fragColor = vec4(0.0,0.0,0.0,1.0);

    if (depth != 1) {
        vec4 world_pos = invViewMatrix * vec4(view_pos, 1);

        vec4 diffuseSpecularComp = calcAmbient(ambientLight, diffuse);

        for (int i=0; i<MAX_POINT_LIGHTS; i++) {

            if (pointLights[i].intensity > 0) {
                vec4 pos = invProjectionMatrix * vec4(pointLights[i].position,1);
                diffuseSpecularComp += calcPointLight(diffuse, specular, reflectance, pointLights[i], view_pos, normal) * calcCubeShadow(world_pos, pos.xyz / pos.w, index);
                index += NUM_FACES;
            }
        }

        for (int i=0; i<MAX_SPOT_LIGHTS; i++) {
            if (spotLights[i].pl.intensity > 0) {
                diffuseSpecularComp += calcSpotLight(diffuse, specular, reflectance, spotLights[i], view_pos, normal) * calcShadow(world_pos, index);
                index ++;
            }
        }

        int tempindex = 0;

        for (int i=0; i<MAX_DIR_LIGHTS; i++) {
            if (dirLights[i].intensity > 0) {
                int cascadeIndex = 0;
                for (int j=0; j<NUM_CASCADES - 1; j++) {
                    if (view_pos.z < shadows[index + j].splitDistance) {
                        cascadeIndex = j + 1;
                    }
                }
                diffuseSpecularComp += calcDirLight(diffuse, specular, reflectance, dirLights[i], view_pos, normal) * calcDirShadow(world_pos, tempindex + cascadeIndex, index + cascadeIndex);
                tempindex += NUM_CASCADES;
                index += NUM_CASCADES;
            }
        }

        fragColor = diffuseSpecularComp;    
    }else if(fog.activeFog == 0){
        discard;
    }
    
    if (fog.activeFog == 1) {
        float expo = log(length(view_pos) / 10.0 + 1) + 1;
        for(int a = 1; a < FOG_QUALITY + 1; a++){

            index = 0;

            vec4 fogComp = calcAmbient(ambientLight, vec4(fog.color,1));
            float fogFactor = 1.0 / exp(length(view_pos) * abs(pow(1.0 * (FOG_QUALITY - a + 1) / FOG_QUALITY, expo) - pow(1.0 * (FOG_QUALITY - a) / FOG_QUALITY, expo)) * fog.density);
            vec3 view_slice = view_w.xyz / view_w.w * pow(1.0 * (FOG_QUALITY - a) / FOG_QUALITY, expo);
            vec4 world_slice = invViewMatrix * vec4(view_slice, 1);
            for (int i=0; i<MAX_POINT_LIGHTS; i++) {
                if (pointLights[i].intensity > 0) {
                    vec4 pos = invProjectionMatrix * vec4(pointLights[i].position,1);
                    fogComp += calcPointLightFog(vec4(fog.color,1), pointLights[i], view_slice) * calcCubeShadow(world_slice, pos.xyz / pos.w, index);
                    index += NUM_FACES;
                }
            }

            for (int i=0; i<MAX_SPOT_LIGHTS; i++) {
                if (spotLights[i].pl.intensity > 0) {
                    fogComp += calcSpotLightFog(vec4(fog.color,1), spotLights[i], view_slice) * calcShadow(world_slice, index);
                    index ++;
                }
            }

            int tempindex = 0;

            for (int i=0; i<MAX_DIR_LIGHTS; i++) {
                if (dirLights[i].intensity > 0) {
                    int cascadeIndex = 0;
                    for (int j=0; j<NUM_CASCADES - 1; j++) {
                        if (view_slice.z < shadows[index + j].splitDistance) {
                            cascadeIndex = j + 1;
                        }
                    }
                    fogComp += calcDirLightFog(vec4(fog.color,1), dirLights[i]) * calcDirShadow(world_slice, tempindex + cascadeIndex, index + cascadeIndex);
                    tempindex += NUM_CASCADES;
                    index += NUM_CASCADES;
                }
            }
            
            fragColor = mix(fogComp, fragColor, fogFactor);
        }
    }
    fragColor = vec4(pow(fragColor.r, 0.7), pow(fragColor.g, 0.7), pow(fragColor.b, 0.7), fragColor.a);
}