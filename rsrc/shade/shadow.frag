#version 460

out float fragmentDepth;

void main(){
    fragmentDepth = sqrt(pow(gl_FragCoord.x, 2.0)+pow(gl_FragCoord.y, 2.0)+pow(gl_FragCoord.z, 2.0));
}