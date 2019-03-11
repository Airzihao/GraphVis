import { notDeepStrictEqual } from "assert";
import { relative } from "path";

/**
 * Community Zone Solver is the tool to find the outline of different communities.
 */

 /**
  * the class for community 

  */

 var directionVector = new Array()
 directionVector[0] = [0,1];
 directionVector[1] = [1/2,Math.sqrt(3)/2];
 directionVector[2] = [Math.sqrt(3)/2,1/2];
 directionVector[3] = [1,0];
 directionVector[4] = [Math.sqrt(3)/2,-1/2];
 directionVector[5] = [1/2,-Math.sqrt(3)/2];
 directionVector[6] = [0,-1];
 directionVector[7] = [-1/2,-Math.sqrt(3)/2];
 directionVector[8] = [-Math.sqrt(3)/2,-1/2];
 directionVector[9] = [-1,0]
 directionVector[10] = [-Math.sqrt(3)/2,1/2];
 directionVector[11] = [-1/2,Math.sqrt(3)/2];


// the arg nodes is an array of all the nodes in the same community.
class Community {
  /**
     * @param {Number} nodeCount
     * @param {Array} nodes
     * @param {Array} outline
     */
  constructor(nodes) {
    this.nodeCount = nodes.length;
    this.nodes = nodes;
    this.center = getCommunityCenter(nodes); //the center is an array, where center[0]=x, center[1]=y;
    this.outline = getOutline(this);
  }
}

function getOutline(community){
    var nodes = community.nodes;
    var x0 = community.center[0];
    var y0 = community.center[1];
    var relative_x, relative_y;
    var direction_x, direction_y;
    var x,y;
    var outlinePoint = [[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]];
    for(let i=0;i<nodes.length;i++){
      for(let j=0;j<directionVector.length;j++){
        relative_x = nodes[i].x-x0;
        relative_y = nodes[i].y-y0;
        direction_x = directionVector[j][0];
        direction_y = directionVector[j][1];
        length = Math.sqrt(relative_x*relative_x+relative_y*relative_y);
        x = length*length/(relative_x*direction_x+relative_y*direction_y)*direction_x;
        y = length*length/(relative_x*direction_x+relative_y*direction_y)*direction_y;
        if(Math.abs(x)>Math.abs(outlinePoint[j][0])){
          outlinePoint[j][0] = x;
          outlinePoint[j][1] = y;
        }
      }
    }
    return outlinePoint;
}

function getCommunityCenter(communityNodes){
  var sum_x=0,sum_y=0;
  for (let i=0;i<communityNodes.length;i++){
    sum_x += communityNodes[i].x;
    sum_y += communityNodes[i].y;
  }
  var communityCentralNode = [sum_x/communityNodes.length,sum_y/communityNodes.length];
  return communityCentralNode;
}


class CommunityZoneFinder {
    /**
     * @param {Object} body
     * @param {{physicsNodeIndices: Array, physicsEdgeIndices: Array, forces: {}, velocities: {}}} physicsBody
     * @param {Object} options
     */
    constructor(body, physicsBody, options) {
      this.body = body;
      this.physicsBody = physicsBody;
      this.setOptions(options);
    }
  
    /**
     *
     * @param {Object} options
     */
    setOptions(options) {
      this.options = options;
    }

    solve() {     
      var allNodes = this.body.nodes
      var nodeList = this.sortByCommunity(allNodes)
      var communityNodeList = [[]];  // the array of the array of the nodes that are in the same community.
      var communityList = new Array(); // the array of the community object.
      var communityCount = this.getCommunityCount(nodeList,communityNodeList)
      
      for(let i=0;i<communityCount;i++){
          communityList[i] = new Community(communityNodeList[i])
          console.log(communityList[i].outline)
        }    
    }
    
    sortByCommunity(allNodes){
      var nodeIndices = this.physicsBody.physicsNodeIndices;
      var nodeList= [[]];
      for(let i=0;i<nodeIndices.length;i++){
        var node = allNodes[nodeIndices[i]]
        if (nodeList[node.options.group] === undefined){
          nodeList.push([])
        }
        nodeList[node.options.group].push(node)
      }
      return nodeList;
    }
    getCommunityCount(nodeList,communityNodeList) {
      var count = 0;
      for (let i=0; i<nodeList.length;i++){

        communityNodeList[count] = nodeList[i];
        count ++;
      }
      return count;
    }

    
  }
  
  
  export default CommunityZoneFinder;