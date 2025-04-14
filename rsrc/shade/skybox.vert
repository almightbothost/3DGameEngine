#version 330

layout (location=0) in vec3 position;
layout (location=1) in vec3 normal;
layout (location=2) in vec2 texCoord;

out vec2 outTextCoord;

uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;

void main()
{
    mat4 orientationMatrix = mat4(mat3(viewMatrix)); // Extract the orientation (upper-left 3x3 matrix)
    gl_Position = projectionMatrix * orientationMatrix * vec4(position, 1.0);
    outTextCoord = texCoord;
}